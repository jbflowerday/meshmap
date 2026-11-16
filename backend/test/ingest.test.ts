import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { DEFAULT_KEY, encrypt } = await import('../src/crypto.ts');
const { handleMessage } = await import('../src/ingest.ts');
const db = await import('../src/db.ts');
const P = await import('../src/proto/meshtastic.ts');

test('a node that only uplinks its own map reports is marked as a gateway', () => {
  const NODE = 0x63b573ca;
  const id = 4242;
  const report = P.encodeData({ portnum: P.PortNum.MAP_REPORT_APP, payload: new Uint8Array() });
  const pkt = P.encodeMeshPacket({ from: NODE, to: P.BROADCAST, id, channel: 8, hopStart: 3, hopLimit: 3, encrypted: encrypt(report, DEFAULT_KEY, id, NODE) });
  handleMessage('msh/ANZ/2/e/LongFast/!63b573ca', Buffer.from(P.encodeServiceEnvelope(pkt, 'LongFast', '!63b573ca')));

  const node = db.getNode(NODE);
  assert.equal(node?.is_gateway, 1);
  assert.equal(db.listLinks(3600).length, 0, 'no self link');
});

test("MeshMap's own downlinked packets are ignored and its old node row is removed", async () => {
  const SELF = 0x7c10a186;
  const id = 777;
  const data = P.encodeData({ portnum: P.PortNum.NODEINFO_APP, payload: P.encodeUser({ id: '!7c10a186', longName: 'MeshMap' }), wantResponse: true });
  const pkt = P.encodeMeshPacket({ from: SELF, to: 0xdbc30437, id, channel: 8, hopStart: 3, hopLimit: 3, encrypted: encrypt(data, DEFAULT_KEY, id, SELF) });
  const msg = Buffer.from(P.encodeServiceEnvelope(pkt, 'LongFast', '!7c10a186'));

  handleMessage('msh/ANZ/2/e/LongFast/!7c10a186', msg); // before MeshMap knows its id (old behaviour)
  assert.equal(db.getNode(SELF)?.is_gateway, 1);

  process.env.NAME_REQUEST_NODE_ID = '!7c10a186';
  const { config } = await import('../src/config.ts');
  config.nameRequests.nodeId = '!7c10a186';
  const { requesterNodeNum } = await import('../src/downlink.ts');
  assert.equal(requesterNodeNum(), SELF);
  assert.equal(db.getNode(SELF), undefined, 'old row removed');

  handleMessage('msh/ANZ/2/e/LongFast/!7c10a186', msg);
  assert.equal(db.getNode(SELF), undefined, 'own packets ignored');
});
