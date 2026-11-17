// Publishes realistic, encrypted Meshtastic MQTT traffic for a fake mesh so the
// map can be developed/demoed without real radios.
//
//   node scripts/simulate.ts [--broker] [--nodes 30] [--stack 0] [--url mqtt://localhost:1883]
//
// --broker starts an embedded MQTT broker (aedes) on :1883 for local dev without Docker.
import { createServer } from 'node:net';
import { randomInt } from 'node:crypto';
import mqtt from 'mqtt';
import { DEFAULT_KEY, decrypt, encrypt } from '../src/crypto.ts';
import {
  encodeData, encodeMeshPacket, encodeNeighborInfo, encodePosition, encodeRouteDiscovery, encodeServiceEnvelope,
  encodeTelemetry, encodeUser, nodeIdFromNum, PortNum, decodeServiceEnvelope, decodeData,
} from '../src/proto/meshtastic.ts';

const args = process.argv.slice(2);
const arg = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const N = Number(arg('nodes', '30'));
const URL_ = arg('url', process.env.MQTT_URL ?? 'mqtt://localhost:1883');
const CENTER = { lat: Number(process.env.SIM_LAT ?? 39.7392), lon: Number(process.env.SIM_LON ?? -104.9903) };
const ROOT = process.env.SIM_ROOT ?? 'msh/US';
const HOP_LIMIT = 3;
const INTERVAL_MS = Number(arg('interval', '700'));
// --stack N: put nodes 2..N+1 at node 1's exact position (tests overlapping markers)
const STACK = Number(arg('stack', '0'));
// --quiet N: N non-gateway nodes never announce their name on their own, but do
// answer NODEINFO requests that arrive via MQTT downlink (tests NAME_REQUESTS)
const QUIET = Number(arg('quiet', '0'));
// --demo: realistic node names instead of "Sim Node NN" (for screenshots)
const DEMO = args.includes('--demo');
const DEMO_ROUTERS = [
  ['Lookout Mtn Router', 'LKMT'], ['Green Mtn Repeater', 'GRMT'], ['Squaw Pass Relay', 'SQPS'],
  ['Mt Morrison Router', 'MORR'], ['Table Mesa Relay', 'TBLM'], ['Cherry Creek Tower', 'CCTW'],
];
const DEMO_NODES = [
  ['Capitol Hill Base', 'CAPH'], ['Wash Park Handheld', 'WPHH'], ['RiNo Rooftop', 'RINO'],
  ['Highlands Solar', 'HLND'], ['Sloan Lake T-Echo', 'SLKE'], ['Aurora Porch', 'AURA'],
  ['Golden Bike Tracker', 'GBIK'], ['Englewood Attic', 'ENGL'], ['Lakewood Base', 'LKWD'],
  ['Arvada Window', 'ARVD'], ['Littleton Car', 'LTCR'], ['Edgewater Balcony', 'EDGW'],
  ['Westminster Base', 'WSTM'], ['Thornton Garage', 'THRN'], ['Glendale Office', 'GLND'],
  ['Baker Handheld', 'BAKR'], ['Five Points Node', 'FVPT'], ['Berkeley Heltec', 'BRKY'],
  ['Wheat Ridge Mast', 'WHRG'], ['Cherry Hills Node', 'CHHL'], ['Hike Tracker', 'HIKE'],
  ['Stapleton Base', 'STPL'], ['Federal Heights', 'FDHT'], ['Sheridan Porch', 'SHRD'],
  ['Morrison Cabin', 'MRSN'], ['Commerce City', 'CMCY'], ['Centennial Node', 'CNTN'],
];

if (args.includes('--broker')) {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  await new Promise<void>((r) => createServer(broker.handle).listen(1883, r));
  console.log('[sim] embedded broker listening on :1883');
}

// ----------------------------------------------------------------- mesh model
const HW = [9, 43, 4, 71, 69, 48, 7, 25];
interface SimNode {
  num: number; name: string; short: string; lat: number; lon: number; alt: number; role: number; hw: number;
  battery: number; uptime: number; gateway: boolean;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const nodes: SimNode[] = Array.from({ length: N }, (_, i) => {
  const r = Math.sqrt(Math.random()) * 0.25; // ~25 km radius
  const th = Math.random() * Math.PI * 2;
  const router = i % 7 === 0;
  const demo = DEMO ? (router ? DEMO_ROUTERS[Math.floor(i / 7) % DEMO_ROUTERS.length] : DEMO_NODES[(i - Math.ceil(i / 7)) % DEMO_NODES.length]) : null;
  return {
    num: (0x5a000000 + randomInt(0xffffff)) >>> 0,
    name: demo ? demo[0] : router ? `Sim Router ${String(i + 1).padStart(2, '0')}` : `Sim Node ${String(i + 1).padStart(2, '0')}`,
    short: demo ? demo[1] : router ? `R${String(i + 1).padStart(2, '0')}` : `S${String(i + 1).padStart(2, '0')}`,
    lat: CENTER.lat + r * Math.cos(th),
    lon: CENTER.lon + (r * Math.sin(th)) / Math.cos((CENTER.lat * Math.PI) / 180),
    alt: Math.round(rand(1550, router ? 2600 : 1800)),
    role: router ? 2 : i % 5 === 1 ? 5 : 0,
    hw: HW[i % HW.length],
    battery: randomInt(30, 101),
    uptime: randomInt(100, 500000),
    gateway: i % 9 === 4 || i === 1,
  };
});

for (let i = 1; i <= STACK && i < nodes.length; i++) {
  nodes[i].lat = nodes[0].lat;
  nodes[i].lon = nodes[0].lon;
}

const distKm = (a: SimNode, b: SimNode) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// adjacency with SNR (dB) at receiver
const adj = new Map<number, Map<number, number>>();
for (const a of nodes) adj.set(a.num, new Map());
for (const a of nodes) {
  for (const b of nodes) {
    if (a === b) continue;
    const range = a.role === 2 || b.role === 2 ? 22 : 10;
    const d = distKm(a, b);
    if (d < range) adj.get(a.num)!.set(b.num, Math.round((10 - 25 * (d / range) + rand(-2, 2)) * 4) / 4);
  }
}

function shortestPath(from: number, to: number): number[] | null {
  const prev = new Map<number, number>([[from, from]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const nb of adj.get(cur)!.keys()) if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

// ----------------------------------------------------------------- publishing
const client = mqtt.connect(URL_, {
  username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD, clientId: `meshmap-sim-${randomInt(1e6)}`,
});
await new Promise<void>((resolve, reject) => {
  client.once('connect', () => resolve());
  client.once('error', reject);
});
console.log(`[sim] connected to ${URL_}; ${N} nodes, gateways: ${nodes.filter((n) => n.gateway).map((n) => n.short).join(', ')}`);

let sent = 0;
function transmit(
  from: SimNode, portnum: number, payload: Uint8Array, opts: { to?: number; requestId?: number; onlyGateway?: SimNode } = {},
) {
  const id = randomInt(1, 0xffffffff) >>> 0;
  const data = encodeData({ portnum, payload, requestId: opts.requestId });
  const enc = encrypt(data, DEFAULT_KEY, id, from.num);
  for (const gw of nodes.filter((n) => n.gateway && (!opts.onlyGateway || n === opts.onlyGateway))) {
    const path = shortestPath(from.num, gw.num);
    if (!path) continue;
    const hops = path.length - 2; // relays between sender and gateway
    const d = from === gw ? 0 : Math.max(0, hops);
    if (d > HOP_LIMIT) continue;
    const lastHopSnr = path.length >= 2 ? adj.get(path[path.length - 2])!.get(gw.num) ?? 0 : 0;
    const pkt = encodeMeshPacket({
      from: from.num, to: opts.to ?? 0xffffffff, id, encrypted: enc, channel: 8,
      hopStart: HOP_LIMIT, hopLimit: HOP_LIMIT - d, rxSnr: from === gw ? 0 : lastHopSnr,
      rxRssi: from === gw ? 0 : Math.round(-120 + (lastHopSnr + 15) * 3), rxTime: Math.floor(Date.now() / 1000),
      relayNode: path.length >= 2 ? path[path.length - 2] & 0xff : 0,
    });
    client.publish(`${ROOT}/2/e/LongFast/${nodeIdFromNum(gw.num)}`, Buffer.from(encodeServiceEnvelope(pkt, 'LongFast', nodeIdFromNum(gw.num))));
    sent++;
  }
}

const quiet = new Set(nodes.filter((n) => !n.gateway).slice(0, QUIET).map((n) => n.num));
const sendNodeInfo = (n: SimNode, to?: number) => {
  if (quiet.has(n.num) && to === undefined) return;
  transmit(n, PortNum.NODEINFO_APP,
    encodeUser({ id: nodeIdFromNum(n.num), longName: n.name, shortName: n.short, hwModel: n.hw, role: n.role }), { to });
};

// Gateways with downlink enabled: deliver NODEINFO and TRACEROUTE requests to the addressed node, which replies.
const gatewayIds = new Set(nodes.filter((n) => n.gateway).map((n) => nodeIdFromNum(n.num)));
client.subscribe(`${ROOT}/2/e/LongFast/+`);
client.on('message', (topic, payload) => {
  const sender = topic.split('/').pop() ?? '';
  if (gatewayIds.has(sender)) return; // our own uplinks
  try {
    const p = decodeServiceEnvelope(payload).packet;
    if (!p?.encrypted) return;
    const d = decodeData(decrypt(p.encrypted, DEFAULT_KEY, p.id, p.from));
    const target = nodes.find((n) => n.num === p.to);
    if (!d.wantResponse || !target) return;
    if (d.portnum === PortNum.TRACEROUTE_APP) {
      console.log(`[sim] downlink: ${nodeIdFromNum(p.from)} traced ${target.short}; replying`);
      setTimeout(() => answerTraceroute(target, p.from, p.id), 1500);
      return;
    }
    if (d.portnum !== PortNum.NODEINFO_APP) return;
    console.log(`[sim] downlink: ${nodeIdFromNum(p.from)} asked ${target.short} for its name; replying`);
    setTimeout(() => sendNodeInfo(target, p.from), 1500);
  } catch { /* not for us */ }
});
// A downlinked traceroute enters the mesh at the gateway nearest the target (the injecting
// gateway doesn't record itself, like firmware). The reply goes back to the nearest gateway,
// which uplinks it. Relays record themselves and the SNR they heard.
function answerTraceroute(target: SimNode, requester: number, requestId: number) {
  const gws = nodes.filter((n) => n.gateway && n !== target);
  const paths = gws.map((g) => shortestPath(g.num, target.num)).filter((x): x is number[] => !!x);
  if (!paths.length) return;
  const fwd = paths.sort((a, b) => a.length - b.length)[0]; // gateway ... target
  const gw = nodes.find((n) => n.num === fwd[0])!;
  const snr = (a: number, b: number) => Math.round((adj.get(a)!.get(b) ?? 0) * 4);
  const route = fwd.slice(1, -1);
  const snrTowards = fwd.slice(1).map((n, i) => snr(fwd[i], n));
  const back = [...fwd].reverse(); // target ... gateway
  const routeBack = back.slice(1, -1);
  const snrBack = routeBack.map((n, i) => snr(back[i], n));
  transmit(target, PortNum.TRACEROUTE_APP, encodeRouteDiscovery({ route, snrTowards, routeBack, snrBack }),
    { to: requester, requestId, onlyGateway: gw });
}

const sendPosition = (n: SimNode) => {
  if (n.role === 5) { n.lat += rand(-0.002, 0.002); n.lon += rand(-0.002, 0.002); } // trackers wander
  transmit(n, PortNum.POSITION_APP, encodePosition({
    latitudeI: Math.round(n.lat * 1e7), longitudeI: Math.round(n.lon * 1e7), altitude: n.alt,
    time: Math.floor(Date.now() / 1000), satsInView: randomInt(4, 14), precisionBits: 32,
  }));
};
const sendTelemetry = (n: SimNode) => {
  n.battery = Math.max(5, Math.min(101, n.battery + randomInt(-2, 2)));
  n.uptime += 900;
  transmit(n, PortNum.TELEMETRY_APP, encodeTelemetry({
    time: Math.floor(Date.now() / 1000),
    deviceMetrics: {
      batteryLevel: n.battery, voltage: 3.3 + (Math.min(n.battery, 100) / 100) * 0.9,
      channelUtilization: rand(2, 25), airUtilTx: rand(0.1, 4), uptimeSeconds: n.uptime,
    },
    environmentMetrics: n.role === 2 ? { temperature: rand(-5, 30), relativeHumidity: rand(10, 80), barometricPressure: rand(800, 850) } : undefined,
  }));
};
const sendNeighbors = (n: SimNode) => transmit(n, PortNum.NEIGHBORINFO_APP, encodeNeighborInfo({
  nodeId: n.num, lastSentById: n.num, nodeBroadcastIntervalSecs: 900,
  neighbors: [...adj.get(n.num)!.entries()].slice(0, 10).map(([nb]) => ({
    nodeId: nb, snr: adj.get(nb)!.get(n.num) ?? 0, lastRxTime: Math.floor(Date.now() / 1000),
  })),
}));
const sendTraceroute = () => {
  const a = nodes[randomInt(N)];
  const b = nodes[randomInt(N)];
  if (a === b) return;
  const path = shortestPath(a.num, b.num);
  if (!path || path.length - 2 > 6) return;
  const snrTowards = path.slice(1).map((n, i) => Math.round((adj.get(path[i])!.get(n) ?? 0) * 4));
  const back = [...path].reverse();
  const snrBack = back.slice(1).map((n, i) => Math.round((adj.get(back[i])!.get(n) ?? 0) * 4));
  // The reply is sent by the target back to the requester.
  transmit(b, PortNum.TRACEROUTE_APP, encodeRouteDiscovery({
    route: path.slice(1, -1), snrTowards, routeBack: back.slice(1, -1), snrBack,
  }), { to: a.num, requestId: randomInt(1, 0xffffffff) });
};

for (const n of nodes) { sendNodeInfo(n); sendPosition(n); }
if (QUIET) console.log(`[sim] quiet nodes (no spontaneous NODEINFO): ${[...quiet].map(nodeIdFromNum).join(', ')}`);
for (const n of nodes) sendNeighbors(n);
for (let i = 0; i < 5; i++) sendTraceroute();

setInterval(() => {
  const n = nodes[randomInt(N)];
  const r = Math.random();
  if (r < 0.1) sendNodeInfo(n);
  else if (r < 0.35) sendPosition(n);
  else if (r < 0.7) sendTelemetry(n);
  else if (r < 0.85) sendNeighbors(n);
  else sendTraceroute();
}, INTERVAL_MS);

setInterval(() => console.log(`[sim] ${sent} envelopes published`), 15000);
