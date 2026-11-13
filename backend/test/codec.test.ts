import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEY, decrypt, encrypt, expandKey } from '../src/crypto.ts';
import {
  decodeData, decodeNeighborInfo, decodePosition, decodeRouteDiscovery, decodeServiceEnvelope, decodeTelemetry,
  decodeUser, encodeData, encodeMeshPacket, encodeNeighborInfo, encodePosition, encodeRouteDiscovery,
  encodeServiceEnvelope, encodeTelemetry, encodeUser, nodeIdFromNum, nodeNumFromId, PortNum,
} from '../src/proto/meshtastic.ts';

test('node id conversions', () => {
  assert.equal(nodeIdFromNum(0xa1b2c3d4), '!a1b2c3d4');
  assert.equal(nodeNumFromId('!a1b2c3d4'), 0xa1b2c3d4);
  assert.equal(nodeNumFromId('nope'), null);
});

test('default key expansion', () => {
  assert.deepEqual(expandKey(Buffer.from('AQ==', 'base64')), DEFAULT_KEY);
  const k2 = expandKey(Buffer.from([2]))!;
  assert.equal(k2[15], (DEFAULT_KEY[15] + 1) & 0xff);
  assert.equal(expandKey(Buffer.from([0])), null);
});

test('encrypted envelope round trip', () => {
  const user = encodeUser({ id: '!0000abcd', longName: 'Test Node', shortName: 'TST', hwModel: 43, role: 2 });
  const data = encodeData({ portnum: PortNum.NODEINFO_APP, payload: user });
  const enc = encrypt(data, DEFAULT_KEY, 1234, 0xabcd);
  const pkt = encodeMeshPacket({ from: 0xabcd, to: 0xffffffff, id: 1234, encrypted: enc, hopStart: 3, hopLimit: 2, rxSnr: 6.5, rxRssi: -90 });
  const env = decodeServiceEnvelope(encodeServiceEnvelope(pkt, 'LongFast', '!deadbeef'));
  assert.equal(env.gatewayId, '!deadbeef');
  assert.equal(env.channelId, 'LongFast');
  const p = env.packet!;
  assert.equal(p.from, 0xabcd);
  assert.equal(p.to, 0xffffffff);
  assert.equal(p.hopStart, 3);
  assert.equal(p.hopLimit, 2);
  assert.equal(p.rxRssi, -90);
  assert.ok(Math.abs(p.rxSnr - 6.5) < 1e-6);
  const d = decodeData(decrypt(p.encrypted!, DEFAULT_KEY, p.id, p.from));
  assert.equal(d.portnum, PortNum.NODEINFO_APP);
  const u = decodeUser(d.payload);
  assert.equal(u.longName, 'Test Node');
  assert.equal(u.shortName, 'TST');
  assert.equal(u.hwModel, 43);
  assert.equal(u.role, 2);
});

test('position with negative coordinates', () => {
  const p = decodePosition(encodePosition({ latitudeI: -337000000, longitudeI: -1512000000, altitude: -5, precisionBits: 13 }));
  assert.equal(p.latitudeI, -337000000);
  assert.equal(p.longitudeI, -1512000000);
  assert.equal(p.altitude, -5);
  assert.equal(p.precisionBits, 13);
});

test('telemetry', () => {
  const t = decodeTelemetry(encodeTelemetry({
    time: 100, deviceMetrics: { batteryLevel: 87, voltage: 4.1, channelUtilization: 12.5, airUtilTx: 1.25, uptimeSeconds: 3600 },
    environmentMetrics: { temperature: -3.5, relativeHumidity: 40 },
  }));
  assert.equal(t.deviceMetrics?.batteryLevel, 87);
  assert.equal(t.deviceMetrics?.uptimeSeconds, 3600);
  assert.ok(Math.abs((t.environmentMetrics?.temperature ?? 0) + 3.5) < 1e-6);
});

test('neighbor info and route discovery', () => {
  const ni = decodeNeighborInfo(encodeNeighborInfo({
    nodeId: 1, lastSentById: 1, nodeBroadcastIntervalSecs: 900,
    neighbors: [{ nodeId: 2, snr: -7.25, lastRxTime: 5 }, { nodeId: 3, snr: 4, lastRxTime: 6 }],
  }));
  assert.equal(ni.neighbors.length, 2);
  assert.equal(ni.neighbors[0].snr, -7.25);
  const rd = decodeRouteDiscovery(encodeRouteDiscovery({ route: [10, 0xfffffffe], snrTowards: [24, -40, 8], routeBack: [11], snrBack: [-4, 12] }));
  assert.deepEqual(rd.route, [10, 0xfffffffe]);
  assert.deepEqual(rd.snrTowards, [24, -40, 8]);
  assert.deepEqual(rd.routeBack, [11]);
  assert.deepEqual(rd.snrBack, [-4, 12]);
});
