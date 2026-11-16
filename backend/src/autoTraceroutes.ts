// Sends traceroutes to known nodes on a schedule, the same way "Traceroute" in the
// Meshtastic app does: a TRACEROUTE packet with want_response, sent from MeshMap's
// own node id and downlinked through the gateway that last heard the node. The reply
// carries the path both ways, which ingest turns into links.
//
// Every traceroute floods the mesh, so this is opt-in and limited: at most
// TRACEROUTE_MAX_PER_HOUR per hour, at least TRACEROUTE_MIN_INTERVAL_SECONDS apart,
// each node at most once per TRACEROUTE_RETRY_HOURS, and never within 30 s of any
// other packet MeshMap sends.
import { config } from './config.ts';
import * as db from './db.ts';
import { buildDownlink, downlinkGate, requesterNodeNum, type Publish } from './downlink.ts';
import { encodeData, encodeRouteDiscovery, nodeIdFromNum, PortNum } from './proto/meshtastic.ts';

const TICK_MS = 30_000;

export const tracerouteStatus = { enabled: false, sentThisRun: 0, lastError: '' };

/** Builds one traceroute request. Returns the packet id, MQTT topic and envelope bytes, or null if no route is known. */
export function buildTracerouteRequest(target: number, gateway: number, hopsAway: number | null, from: number) {
  const data = encodeData({
    portnum: PortNum.TRACEROUTE_APP,
    payload: encodeRouteDiscovery({ route: [], snrTowards: [], routeBack: [], snrBack: [] }),
    wantResponse: true,
  });
  return buildDownlink(target, gateway, data, Math.max(config.traceroutes.hopLimit, (hopsAway ?? 0) + 1), from);
}

/** One scheduling pass. Exported for tests. Sends at most one traceroute; returns its target. */
export function tracerouteTick(publish: Publish, connected: () => boolean, from: number): number | null {
  const tr = config.traceroutes;
  if (!tr.enabled || !connected()) return null;
  const now = db.nowSec();
  if (!downlinkGate.open(now)) return null;
  const stats = db.tracerouteRequestStats();
  if (stats.sentLastHour >= tr.maxPerHour) return null;
  if (now - stats.lastSentAt < tr.minIntervalSeconds) return null;

  const candidates = db.tracerouteCandidates({
    heardSince: now - tr.heardWithinMinutes * 60,
    retryBefore: now - tr.retryHours * 3600,
    minHopsAway: tr.minHopsAway,
    maxHopsAway: tr.maxHopsAway,
    exclude: from,
  });
  for (const c of candidates) {
    const req = buildTracerouteRequest(c.num, c.last_gateway, c.hops_away, from);
    if (!req) continue; // no encrypted uplink seen from that gateway yet
    try {
      publish(req.topic, req.payload);
    } catch (err) {
      tracerouteStatus.lastError = (err as Error).message;
      return null;
    }
    downlinkGate.mark(now);
    db.recordTracerouteRequest(c.num, c.last_gateway, req.id);
    tracerouteStatus.sentThisRun++;
    console.log(`[traceroute] tracing ${nodeIdFromNum(c.num)} via ${nodeIdFromNum(c.last_gateway)} (${req.topic})`);
    return c.num;
  }
  return null;
}

export function startTracerouteScheduler(publish: Publish, connected: () => boolean) {
  const from = requesterNodeNum();
  const tr = config.traceroutes;
  tracerouteStatus.enabled = tr.enabled;
  if (tr.enabled) {
    console.log(`[traceroute] scheduled traceroutes on as ${nodeIdFromNum(from)} (max ${tr.maxPerHour}/h, ≥${tr.minIntervalSeconds}s apart)`);
  }
  setInterval(() => tracerouteTick(publish, connected, from), TICK_MS).unref();
}
