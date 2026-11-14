// Asks unnamed nodes for their NODEINFO, the same way "Exchange user info" in the
// Meshtastic app does: a NODEINFO packet with want_response, sent from MeshMap's
// own node id and downlinked through the gateway that last heard the node. The
// node's reply is uplinked by the gateway like any other packet and fills in the name.
//
// Airtime is shared, so this is opt-in and strictly limited: at most one request
// every 30 s, NAME_REQUEST_MAX_PER_HOUR per hour, and each node at most once per
// NAME_REQUEST_RETRY_HOURS.
import { randomInt } from 'node:crypto';
import { config } from './config.ts';
import { encrypt } from './crypto.ts';
import * as db from './db.ts';
import { gatewayRoutes } from './ingest.ts';
import {
  encodeData, encodeMeshPacket, encodeServiceEnvelope, encodeUser, nodeIdFromNum, nodeNumFromId, PortNum,
} from './proto/meshtastic.ts';

const TICK_MS = 30_000;
const PRIVATE_HW = 255;
const ROLE_CLIENT_MUTE = 1;

export type Publish = (topic: string, payload: Buffer) => void;

export const nameRequestStatus = { enabled: false, nodeId: '', sentThisRun: 0, lastSentAt: 0, lastError: '' };

/** MeshMap's own node number for requests: configured, or random and persisted. */
export function requesterNodeNum(): number {
  const cfg = config.nameRequests.nodeId ? nodeNumFromId(config.nameRequests.nodeId) : null;
  if (cfg !== null) return cfg;
  const saved = db.getSetting('requester_node_num');
  if (saved) return Number(saved) >>> 0;
  const num = randomInt(0x10000000, 0xeffffff0) >>> 0;
  db.setSetting('requester_node_num', String(num));
  return num;
}

/** Builds one NODEINFO request. Returns the MQTT topic and envelope bytes, or null if no route is known. */
export function buildNameRequest(target: number, gateway: number, hopsAway: number | null, from: number) {
  const route = gatewayRoutes.get(gateway);
  if (!route) return null;
  const nr = config.nameRequests;
  const id = randomInt(1, 0xffffffff) >>> 0;
  const user = encodeUser({
    id: nodeIdFromNum(from), longName: nr.longName, shortName: nr.shortName, hwModel: PRIVATE_HW, role: ROLE_CLIENT_MUTE,
  });
  const data = encodeData({ portnum: PortNum.NODEINFO_APP, payload: user, wantResponse: true });
  // Enough hops to reach the node from the gateway, and never above the protocol max of 7.
  const hopLimit = Math.min(7, Math.max(nr.hopLimit, (hopsAway ?? 0) + 1));
  const packet = encodeMeshPacket({
    from, to: target, id, channel: route.channelHash, hopLimit, hopStart: hopLimit,
    encrypted: encrypt(data, route.key, id, from),
  });
  const fromId = nodeIdFromNum(from);
  return {
    topic: `${route.root}/2/e/${route.channelId}/${fromId}`,
    payload: Buffer.from(encodeServiceEnvelope(packet, route.channelId, fromId)),
  };
}

/** One scheduling pass. Exported for tests. Sends at most one request. */
export function nameRequestTick(publish: Publish, connected: () => boolean, from: number): number | null {
  db.markNameRequestsAnswered();
  const nr = config.nameRequests;
  if (!nr.enabled || !connected()) return null;
  const now = db.nowSec();
  if (db.nameRequestStats().sentLastHour >= nr.maxPerHour) return null;

  const candidates = db.nameRequestCandidates({
    heardSince: now - nr.heardWithinMinutes * 60,
    firstSeenBefore: now - nr.minAgeMinutes * 60,
    retryBefore: now - nr.retryHours * 3600,
    exclude: from,
  });
  for (const c of candidates) {
    const req = buildNameRequest(c.num, c.last_gateway, c.hops_away, from);
    if (!req) continue; // no encrypted uplink seen from that gateway yet
    try {
      publish(req.topic, req.payload);
    } catch (err) {
      nameRequestStatus.lastError = (err as Error).message;
      return null;
    }
    db.recordNameRequest(c.num, c.last_gateway);
    nameRequestStatus.sentThisRun++;
    nameRequestStatus.lastSentAt = now;
    console.log(`[names] asked ${nodeIdFromNum(c.num)} for its name via ${nodeIdFromNum(c.last_gateway)} (${req.topic})`);
    return c.num;
  }
  return null;
}

export function startNameRequester(publish: Publish, connected: () => boolean) {
  const from = requesterNodeNum();
  nameRequestStatus.enabled = config.nameRequests.enabled;
  nameRequestStatus.nodeId = nodeIdFromNum(from);
  if (config.nameRequests.enabled) {
    console.log(`[names] auto name requests on as ${nodeIdFromNum(from)} (max ${config.nameRequests.maxPerHour}/h)`);
  }
  setInterval(() => nameRequestTick(publish, connected, from), TICK_MS).unref();
}
