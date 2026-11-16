import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.AUTO_TRACEROUTES = 'true';
process.env.NAME_REQUEST_NODE_ID = '!4d4d0001';

const { DEFAULT_KEY, decrypt, encrypt } = await import('../src/crypto.ts');
const ingest = await import('../src/ingest.ts');
const { handleMessage } = ingest;
const { tracerouteTick } = await import('../src/autoTraceroutes.ts');
const { downlinkGate, requesterNodeNum } = await import('../src/downlink.ts');
const db = await import('../src/db.ts');
const P = await import('../src/proto/meshtastic.ts');

const ROOT = 'msh/ANZ';
const GW = 0x9242543c;
const RELAY = 0x11112222;
const NODE = 0xdbc30437;
const SELF = 0x4d4d0001;

function uplink(pkt: Uint8Array) {
  handleMessage(`${ROOT}/2/e/LongFast/!9242543c`, Buffer.from(P.encodeServiceEnvelope(pkt, 'LongFast', '!9242543c')));
}
function encPacket(from: number, to: number, id: number, data: Uint8Array, extra: Partial<Parameters<typeof P.encodeMeshPacket>[0]> = {}) {
  return P.encodeMeshPacket({ from, to, id, channel: 8, hopStart: 3, hopLimit: 2, encrypted: encrypt(data, DEFAULT_KEY, id, from), ...extra });
}

let sentId = 0;

test('traces a known node through the gateway that heard it', () => {
  const pos = P.encodeData({ portnum: P.PortNum.POSITION_APP, payload: P.encodePosition({ latitudeI: -204e6, longitudeI: 1485e6 }) });
  uplink(encPacket(NODE, P.BROADCAST, 1234, pos, { hopLimit: 1 }));

  const from = requesterNodeNum();
  assert.equal(from, SELF);
  const sent: { topic: string; payload: Buffer }[] = [];
  assert.equal(tracerouteTick((topic, payload) => sent.push({ topic, payload }), () => true, from), NODE);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].topic, `${ROOT}/2/e/LongFast/!4d4d0001`);

  const p = P.decodeServiceEnvelope(sent[0].payload).packet!;
  assert.equal(p.from, SELF);
  assert.equal(p.to, NODE);
  assert.equal(p.channel, 8);
  assert.ok(p.hopLimit >= 3);
  const d = P.decodeData(decrypt(p.encrypted!, DEFAULT_KEY, p.id, p.from));
  assert.equal(d.portnum, P.PortNum.TRACEROUTE_APP);
  assert.equal(d.wantResponse, true);
  assert.equal(db.getTracerouteRequest(NODE)?.packet_id, p.id);
  sentId = p.id;
});

test('respects the global downlink gap and the minimum interval', () => {
  const send = () => tracerouteTick(() => assert.fail('should not send'), () => true, SELF);
  assert.equal(send(), null, 'blocked by the 30 s gap');
  downlinkGate.reset();
  assert.equal(send(), null, 'blocked by TRACEROUTE_MIN_INTERVAL_SECONDS');
});

test('the reply adds links through the gateways, never to MeshMap itself', () => {
  const rd = P.encodeRouteDiscovery({ route: [RELAY], snrTowards: [20, 24], routeBack: [RELAY], snrBack: [28] });
  const data = P.encodeData({ portnum: P.PortNum.TRACEROUTE_APP, payload: rd, requestId: sentId });
  uplink(encPacket(NODE, SELF, 999, data, { rxSnr: 6 }));

  const links = db.listLinks(3600) as { from_num: number; to_num: number; source: string; snr: number | null }[];
  const tr = links.filter((l) => l.source === 'traceroute');
  const has = (a: number, b: number) => tr.find((l) => l.from_num === a && l.to_num === b);
  assert.equal(has(GW, RELAY)?.snr, 5, 'request entered the mesh at the gateway');
  assert.equal(has(RELAY, NODE)?.snr, 6);
  assert.equal(has(NODE, RELAY)?.snr, 7);
  assert.equal(has(RELAY, GW)?.snr, 6, 'reply was heard by the uplinking gateway');
  assert.ok(!links.some((l) => l.from_num === SELF || l.to_num === SELF));
  assert.ok(db.getTracerouteRequest(NODE)?.answered_at);

  const [t] = db.listTraceroutes(1) as { route: number[]; snr_towards: (number | null)[] }[];
  const tb = t as unknown as { route_back: number[]; snr_back: (number | null)[] };
  assert.deepEqual(t.route, [GW, RELAY, NODE], 'MeshMap is not a hop');
  assert.deepEqual(t.snr_towards, [5, 6]);
  assert.deepEqual(tb.route_back, [NODE, RELAY, GW]);
  assert.deepEqual(tb.snr_back, [7, 6]);
});

test('strips MeshMap from traceroutes stored before this change', () => {
  db.addTraceroute({
    packetId: 31337, from: SELF, to: NODE, route: [SELF, GW, RELAY, NODE], snrTowards: [null, 5, 6],
    routeBack: [NODE, RELAY, GW, SELF], snrBack: [7, 6, null], gateway: GW,
  });
  const { withoutSelf } = ingest;
  assert.equal(db.stripNodeFromTraceroutes(SELF, withoutSelf), 1);
  assert.equal(db.stripNodeFromTraceroutes(SELF, withoutSelf), 0, 'idempotent');
  const t = (db.listTraceroutes(10) as { packet_id: number; route: number[]; route_back: number[]; snr_back: unknown[] }[])
    .find((r) => r.packet_id === 31337)!;
  assert.deepEqual(t.route, [GW, RELAY, NODE]);
  assert.deepEqual(t.route_back, [NODE, RELAY, GW]);
  assert.deepEqual(t.snr_back, [7, 6]);
});
