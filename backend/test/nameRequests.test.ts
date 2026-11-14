import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.NAME_REQUESTS = 'true';
process.env.NAME_REQUEST_MIN_AGE_MINUTES = '0';
process.env.NAME_REQUEST_NODE_ID = '!4d4d0001';

const { DEFAULT_KEY, decrypt, encrypt } = await import('../src/crypto.ts');
const { handleMessage } = await import('../src/ingest.ts');
const { nameRequestTick, requesterNodeNum } = await import('../src/nameRequests.ts');
const db = await import('../src/db.ts');
const P = await import('../src/proto/meshtastic.ts');

const NODE = 0xdbc30437;
const ROOT = 'msh/ANZ';

/** Simulates the gateway uplinking an encrypted position from NODE, heard 2 hops away. */
function uplinkPosition() {
  const id = 1234;
  const data = P.encodeData({ portnum: P.PortNum.POSITION_APP, payload: P.encodePosition({ latitudeI: -204e6, longitudeI: 1485e6 }) });
  const pkt = P.encodeMeshPacket({ from: NODE, to: P.BROADCAST, id, channel: 8, hopStart: 3, hopLimit: 1, encrypted: encrypt(data, DEFAULT_KEY, id, NODE) });
  handleMessage(`${ROOT}/2/e/LongFast/!9242543c`, Buffer.from(P.encodeServiceEnvelope(pkt, 'LongFast', '!9242543c')));
}

test('requests the name of an unnamed node through the gateway that heard it', () => {
  uplinkPosition();
  const sent: { topic: string; payload: Buffer }[] = [];
  const from = requesterNodeNum();
  assert.equal(from, 0x4d4d0001);

  const asked = nameRequestTick((topic, payload) => sent.push({ topic, payload }), () => true, from);
  assert.equal(asked, NODE);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].topic, `${ROOT}/2/e/LongFast/!4d4d0001`);

  // Decode exactly as the gateway firmware would.
  const env = P.decodeServiceEnvelope(sent[0].payload);
  assert.equal(env.channelId, 'LongFast');
  assert.equal(env.gatewayId, '!4d4d0001');
  const p = env.packet!;
  assert.equal(p.from, from);
  assert.equal(p.to, NODE);
  assert.equal(p.channel, 8, 'uses the channel hash seen on uplinks');
  assert.ok(p.hopLimit >= 3 && p.hopLimit === p.hopStart);
  const d = P.decodeData(decrypt(p.encrypted!, DEFAULT_KEY, p.id, p.from));
  assert.equal(d.portnum, P.PortNum.NODEINFO_APP);
  assert.equal(d.wantResponse, true);
  const u = P.decodeUser(d.payload);
  assert.equal(u.id, '!4d4d0001');
  assert.equal(u.longName, 'MeshMap');
});

test('does not ask the same node again within the retry window', () => {
  const sent: unknown[] = [];
  assert.equal(nameRequestTick(() => sent.push(1), () => true, requesterNodeNum()), null);
  assert.equal(sent.length, 0);
});

test('marks the request answered once the reply (NODEINFO) arrives', () => {
  const id = 5678;
  const data = P.encodeData({ portnum: P.PortNum.NODEINFO_APP, payload: P.encodeUser({ id: '!dbc30437', longName: 'Hill Top', shortName: 'HILL' }) });
  const pkt = P.encodeMeshPacket({ from: NODE, to: 0x4d4d0001, id, channel: 8, hopStart: 3, hopLimit: 1, encrypted: encrypt(data, DEFAULT_KEY, id, NODE) });
  handleMessage(`${ROOT}/2/e/LongFast/!9242543c`, Buffer.from(P.encodeServiceEnvelope(pkt, 'LongFast', '!9242543c')));
  nameRequestTick(() => {}, () => true, requesterNodeNum());
  assert.equal(db.getNode(NODE)?.long_name, 'Hill Top');
  assert.ok(db.getNameRequest(NODE)?.answered_at);
});

test('does nothing while the MQTT client is disconnected', () => {
  const sent: unknown[] = [];
  assert.equal(nameRequestTick(() => sent.push(1), () => false, requesterNodeNum()), null);
  assert.equal(sent.length, 0);
});
