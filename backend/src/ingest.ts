import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import { decrypt } from './crypto.ts';
import * as db from './db.ts';
import {
  BROADCAST, PORT_NAMES, PortNum, decodeData, decodeMapReport, decodeNeighborInfo, decodePosition,
  decodeRouteDiscovery, decodeServiceEnvelope, decodeTelemetry, decodeUser, nodeIdFromNum, nodeNumFromId,
  type Data, type MeshPacket,
} from './proto/meshtastic.ts';

/** Emits: 'node' (num), 'link' (row), 'traceroute' (row), 'packet' (summary) */
export const events = new EventEmitter();
events.setMaxListeners(0);

export const counters = { messages: 0, packets: 0, decrypted: 0, undecryptable: 0, errors: 0 };

// --------------------------------------------------------------- dedupe
// A packet heard by several gateways arrives several times. Payload is processed
// once; per-gateway facts (hops, direct links) are recorded on every copy.
const seen = new Map<string, { t: number; minHops: number | null }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of seen) if (v.t < cutoff) seen.delete(k);
}, 60_000).unref();

// --------------------------------------------------------------- entry point

export function handleMessage(topic: string, payload: Buffer) {
  counters.messages++;
  try {
    if (topic.includes('/stat/')) return handleStatus(topic, payload);
    if (topic.includes('/json/')) return handleJson(payload);
    const env = decodeServiceEnvelope(payload);
    if (!env.packet) return;
    handlePacket(env.packet, env.channelId, nodeNumFromId(env.gatewayId));
  } catch (err) {
    counters.errors++;
    if (process.env.DEBUG) console.warn(`[ingest] failed on ${topic}:`, (err as Error).message);
  }
}

function handleStatus(topic: string, payload: Buffer) {
  const gwId = topic.split('/').pop() ?? '';
  const num = nodeNumFromId(gwId);
  if (num === null) return;
  const status = payload.toString('utf8').trim().slice(0, 16);
  db.touchNode(num, nodeIdFromNum(num), { is_gateway: 1, gateway_status: status });
  events.emit('node', num);
}

function tryDecrypt(p: MeshPacket): Data | null {
  if (!p.encrypted || p.pkiEncrypted) return null;
  for (const key of config.keys) {
    try {
      const plain = decrypt(p.encrypted, key, p.id, p.from);
      const data = decodeData(plain);
      // Wrong key yields garbage; require a known port and sane structure.
      if (data.portnum > 0 && PORT_NAMES[data.portnum] !== undefined) return data;
    } catch {
      /* try next key */
    }
  }
  return null;
}

export function handlePacket(p: MeshPacket, channelId: string, gateway: number | null) {
  if (!p.from || p.from === BROADCAST) return;
  counters.packets++;

  const encrypted = !!p.encrypted;
  let data = p.decoded ?? null;
  if (!data && encrypted) {
    data = tryDecrypt(p);
    if (data) counters.decrypted++;
    else counters.undecryptable++;
  }

  const hops = p.hopStart > 0 && p.hopStart >= p.hopLimit ? p.hopStart - p.hopLimit : null;

  db.addPacket({
    packetId: p.id, from: p.from, to: p.to, portnum: data?.portnum ?? null, channelId, gateway,
    hopStart: p.hopStart, hopLimit: p.hopLimit, relayNode: p.relayNode, snr: p.rxSnr, rssi: p.rxRssi, encrypted,
  });

  // Gateway uplinking means it is alive.
  if (gateway !== null && gateway !== p.from) {
    db.touchNode(gateway, nodeIdFromNum(gateway), { is_gateway: 1 });
    events.emit('node', gateway);
  }

  // Heard directly over RF by the gateway (zero hops): that's a real link.
  if (gateway !== null && gateway !== p.from && hops === 0 && !p.viaMqtt) {
    db.upsertLink(p.from, gateway, 'direct', p.rxSnr || null, p.rxRssi || null);
    events.emit('link', db.getLink(p.from, gateway, 'direct'));
  }

  const key = `${p.from}:${p.id}`;
  const prev = seen.get(key);
  const firstCopy = !prev;

  // Sender: hops away = the smallest hop count any gateway observed.
  const patch: Record<string, unknown> = { last_gateway: gateway ?? undefined, via_mqtt: p.viaMqtt };
  if (!p.viaMqtt && hops !== null && (prev?.minHops == null || hops <= prev.minHops)) {
    patch.hops_away = hops;
    if (hops === 0) {
      patch.snr = p.rxSnr || null;
      patch.rssi = p.rxRssi || null;
    }
  }
  seen.set(key, {
    t: Date.now(),
    minHops: prev?.minHops == null ? hops : hops === null ? prev.minHops : Math.min(prev.minHops, hops),
  });
  db.upsertNode(p.from, nodeIdFromNum(p.from), patch, firstCopy);

  if (firstCopy && data) processPayload(p, data, gateway);
  events.emit('node', p.from);
  // Feed shows each packet once, even when several gateways uplinked it.
  if (firstCopy) events.emit('packet', {
    packet_id: p.id, from: p.from, to: p.to, portnum: data?.portnum ?? null, port: data ? PORT_NAMES[data.portnum] : 'ENCRYPTED',
    gateway, hops, snr: p.rxSnr, rssi: p.rxRssi, time: db.nowSec(),
  });
}

function processPayload(p: MeshPacket, d: Data, gateway: number | null) {
  const id = nodeIdFromNum(p.from);
  switch (d.portnum) {
    case PortNum.NODEINFO_APP: {
      const u = decodeUser(d.payload);
      db.upsertNode(p.from, id, {
        long_name: u.longName || undefined, short_name: u.shortName || undefined,
        hw_model: u.hwModel, role: u.role, is_licensed: u.isLicensed, has_public_key: u.hasPublicKey,
      }, false);
      break;
    }
    case PortNum.POSITION_APP: {
      const pos = decodePosition(d.payload);
      applyPosition(p.from, id, pos.latitudeI, pos.longitudeI, pos.altitude, pos.precisionBits, {
        position_time: pos.time || undefined, sats_in_view: pos.satsInView || undefined,
      });
      break;
    }
    case PortNum.TELEMETRY_APP: {
      const t = decodeTelemetry(d.payload);
      const m: Record<string, number | undefined> = {};
      if (t.deviceMetrics) {
        const dm = t.deviceMetrics;
        Object.assign(m, {
          battery: dm.batteryLevel, voltage: dm.voltage, channel_util: dm.channelUtilization,
          air_util_tx: dm.airUtilTx, uptime: dm.uptimeSeconds,
        });
      }
      if (t.environmentMetrics) {
        const em = t.environmentMetrics;
        Object.assign(m, { temperature: em.temperature, humidity: em.relativeHumidity, pressure: em.barometricPressure });
      }
      if (Object.values(m).some((v) => v !== undefined)) {
        db.upsertNode(p.from, id, m, false);
        db.addTelemetry(p.from, m);
      }
      break;
    }
    case PortNum.NEIGHBORINFO_APP: {
      const ni = decodeNeighborInfo(d.payload);
      const reporter = ni.nodeId || p.from;
      for (const nb of ni.neighbors) {
        if (!nb.nodeId || nb.nodeId === BROADCAST) continue;
        db.upsertLink(nb.nodeId, reporter, 'neighbor', nb.snr);
        events.emit('link', db.getLink(nb.nodeId, reporter, 'neighbor'));
      }
      break;
    }
    case PortNum.TRACEROUTE_APP:
      handleTraceroute(p, d, gateway);
      break;
    case PortNum.MAP_REPORT_APP: {
      const m = decodeMapReport(d.payload);
      db.upsertNode(p.from, id, {
        long_name: m.longName || undefined, short_name: m.shortName || undefined, role: m.role, hw_model: m.hwModel,
        firmware: m.firmwareVersion || undefined, region: m.region, modem_preset: m.modemPreset,
        online_local_nodes: m.numOnlineLocalNodes,
      }, false);
      applyPosition(p.from, id, m.latitudeI, m.longitudeI, m.altitude, m.positionPrecision, {});
      break;
    }
  }
}

function applyPosition(
  num: number, id: string, latI: number, lonI: number, alt: number, precision: number, extra: Record<string, unknown>,
) {
  if (!latI && !lonI) return;
  const lat = latI * 1e-7;
  const lon = lonI * 1e-7;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  if (config.minPrecisionBits && precision && precision < config.minPrecisionBits) return;
  db.upsertNode(num, id, { lat, lon, alt: alt || null, precision_bits: precision || null, ...extra }, false);
  db.addPosition(num, lat, lon, alt || null);
}

const SNR_UNKNOWN = -128;
const snrOf = (v: number | undefined) => (v === undefined || v === SNR_UNKNOWN ? null : v / 4);

function linkPath(path: number[], snrs: number[]) {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a === BROADCAST || b === BROADCAST || !a || !b) continue;
    db.upsertLink(a, b, 'traceroute', snrOf(snrs[i]));
    events.emit('link', db.getLink(a, b, 'traceroute'));
  }
}

function handleTraceroute(p: MeshPacket, d: Data, gateway: number | null) {
  // Only replies carry a complete route. Reply: from = target, to = requester.
  if (!d.requestId || p.to === BROADCAST) return;
  const rd = decodeRouteDiscovery(d.payload);
  const requester = p.to;
  const target = p.from;
  const forward = [requester, ...rd.route, target];
  const hasBack = rd.routeBack.length > 0 || rd.snrBack.length > 0;
  const back = hasBack ? [target, ...rd.routeBack, requester] : null;
  const inserted = db.addTraceroute({
    packetId: d.requestId, from: requester, to: target, route: forward, snrTowards: rd.snrTowards.map((s) => s / 4),
    routeBack: back, snrBack: hasBack ? rd.snrBack.map((s) => s / 4) : null, gateway,
  });
  if (!inserted) return;
  linkPath(forward, rd.snrTowards);
  if (back) linkPath(back, rd.snrBack);
  events.emit('traceroute', { from: requester, to: target, route: forward, route_back: back, time: db.nowSec() });
}

// --------------------------------------------------------------- JSON uplink
// Firmware "JSON output" (ESP32 only) publishes msh/<root>/2/json/<channel>/<gateway>.

interface JsonMsg {
  from: number; to: number; id: number; type: string; sender?: string; channel?: number;
  hop_start?: number; hops_away?: number; rssi?: number; snr?: number;
  payload?: Record<string, unknown>;
}

function handleJson(buf: Buffer) {
  const msg = JSON.parse(buf.toString('utf8')) as JsonMsg;
  if (typeof msg.from !== 'number' || typeof msg.id !== 'number') return;
  const from = msg.from >>> 0;
  const gateway = msg.sender ? nodeNumFromId(msg.sender) : null;
  const hopStart = msg.hop_start ?? 0;
  const hopsAway = msg.hops_away ?? null;

  const packet: MeshPacket = {
    from, to: (msg.to ?? BROADCAST) >>> 0, channel: msg.channel ?? 0, id: msg.id >>> 0, rxTime: 0,
    rxSnr: msg.snr ?? 0, rxRssi: msg.rssi ?? 0, hopStart, hopLimit: hopsAway !== null ? hopStart - hopsAway : 0,
    wantAck: false, viaMqtt: false, pkiEncrypted: false, nextHop: 0, relayNode: 0,
  };
  // Route through the common path for bookkeeping, without a payload (JSON payload handled below).
  const key = `${from}:${packet.id}`;
  const firstCopy = !seen.has(key);
  handlePacket(packet, 'json', gateway);
  if (!firstCopy || !msg.payload) return;

  const pl = msg.payload;
  const id = nodeIdFromNum(from);
  const n = (k: string) => (typeof pl[k] === 'number' ? (pl[k] as number) : undefined);
  const s = (k: string) => (typeof pl[k] === 'string' ? (pl[k] as string) : undefined);
  switch (msg.type) {
    case 'nodeinfo':
      db.upsertNode(from, id, { long_name: s('longname'), short_name: s('shortname'), hw_model: n('hardware'), role: n('role') }, false);
      break;
    case 'position':
      applyPosition(from, id, n('latitude_i') ?? 0, n('longitude_i') ?? 0, n('altitude') ?? 0, n('precision_bits') ?? 0, {
        sats_in_view: n('sats_in_view'),
      });
      break;
    case 'telemetry': {
      const m = {
        battery: n('battery_level'), voltage: n('voltage'), channel_util: n('channel_utilization'),
        air_util_tx: n('air_util_tx'), uptime: n('uptime_seconds'), temperature: n('temperature'),
        humidity: n('relative_humidity'), pressure: n('barometric_pressure'),
      };
      if (Object.values(m).some((v) => v !== undefined)) {
        db.upsertNode(from, id, m, false);
        db.addTelemetry(from, m);
      }
      break;
    }
    case 'neighborinfo': {
      const list = Array.isArray(pl.neighbors) ? (pl.neighbors as { node_id?: number; snr?: number }[]) : [];
      for (const nb of list) {
        if (!nb.node_id) continue;
        db.upsertLink(nb.node_id >>> 0, from, 'neighbor', nb.snr ?? null);
        events.emit('link', db.getLink(nb.node_id >>> 0, from, 'neighbor'));
      }
      break;
    }
  }
  events.emit('node', from);
}
