// Shared plumbing for packets MeshMap sends into the mesh via MQTT downlink
// (name requests, scheduled traceroutes): MeshMap's own node id, packet building,
// and a global gap so the two features never transmit back to back.
import { randomInt } from 'node:crypto';
import { config } from './config.ts';
import { encrypt } from './crypto.ts';
import * as db from './db.ts';
import { gatewayRoutes, selfNodes } from './ingest.ts';
import { encodeMeshPacket, encodeServiceEnvelope, nodeIdFromNum, nodeNumFromId } from './proto/meshtastic.ts';

export type Publish = (topic: string, payload: Buffer) => void;

/** Minimum seconds between any two packets MeshMap downlinks, across all features. */
export const MIN_DOWNLINK_GAP_S = 30;
let lastDownlinkAt = 0;
export const downlinkGate = {
  open: (now: number) => now - lastDownlinkAt >= MIN_DOWNLINK_GAP_S,
  mark: (now: number) => { lastDownlinkAt = now; },
  reset: () => { lastDownlinkAt = 0; },
};

/** MeshMap's own node number: configured, or random and persisted. */
export function requesterNodeNum(): number {
  const cfg = config.nameRequests.nodeId ? nodeNumFromId(config.nameRequests.nodeId) : null;
  let num: number;
  if (cfg !== null) num = cfg;
  else {
    const saved = db.getSetting('requester_node_num');
    num = saved ? Number(saved) >>> 0 : randomInt(0x10000000, 0xeffffff0) >>> 0;
    if (!saved) db.setSetting('requester_node_num', String(num));
  }
  if (!selfNodes.has(num)) {
    selfNodes.add(num);
    db.forgetNode(num); // left over from when its own requests were ingested
  }
  return num;
}

/**
 * Builds one encrypted packet from `from` to `target`, to be downlinked through `gateway`.
 * Returns the MQTT topic and envelope bytes, or null if no encrypted uplink from that gateway has been seen.
 */
export function buildDownlink(
  target: number, gateway: number, data: Uint8Array, hopLimit: number, from: number,
) {
  const route = gatewayRoutes.get(gateway);
  if (!route) return null;
  const id = randomInt(1, 0xffffffff) >>> 0;
  const hops = Math.min(7, Math.max(1, hopLimit));
  const packet = encodeMeshPacket({
    from, to: target, id, channel: route.channelHash, hopLimit: hops, hopStart: hops,
    encrypted: encrypt(data, route.key, id, from),
  });
  const fromId = nodeIdFromNum(from);
  return {
    id,
    topic: `${route.root}/2/e/${route.channelId}/${fromId}`,
    payload: Buffer.from(encodeServiceEnvelope(packet, route.channelId, fromId)),
  };
}
