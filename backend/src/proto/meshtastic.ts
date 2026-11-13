// Decoders/encoders for the subset of Meshtastic protobufs (meshtastic/protobufs)
// that a map needs. Field numbers follow mesh.proto, mqtt.proto, telemetry.proto.
import {
  asBool, asBytes, asFloat, asInt32, asString, asUint32,
  readFields, repeated, Writer, type Field,
} from './wire.ts';

export const BROADCAST = 0xffffffff;

export const PortNum = {
  TEXT_MESSAGE_APP: 1,
  POSITION_APP: 3,
  NODEINFO_APP: 4,
  ROUTING_APP: 5,
  ADMIN_APP: 6,
  TEXT_MESSAGE_COMPRESSED_APP: 7,
  WAYPOINT_APP: 8,
  DETECTION_SENSOR_APP: 10,
  PAXCOUNTER_APP: 34,
  STORE_FORWARD_APP: 65,
  RANGE_TEST_APP: 66,
  TELEMETRY_APP: 67,
  TRACEROUTE_APP: 70,
  NEIGHBORINFO_APP: 71,
  MAP_REPORT_APP: 73,
} as const;

export const PORT_NAMES: Record<number, string> = {
  0: 'UNKNOWN', 1: 'TEXT_MESSAGE', 2: 'REMOTE_HARDWARE', 3: 'POSITION', 4: 'NODEINFO',
  5: 'ROUTING', 6: 'ADMIN', 7: 'TEXT_COMPRESSED', 8: 'WAYPOINT', 9: 'AUDIO',
  10: 'DETECTION_SENSOR', 11: 'ALERT', 32: 'REPLY', 33: 'IP_TUNNEL', 34: 'PAXCOUNTER',
  64: 'SERIAL', 65: 'STORE_FORWARD', 66: 'RANGE_TEST', 67: 'TELEMETRY', 68: 'ZPS',
  69: 'SIMULATOR', 70: 'TRACEROUTE', 71: 'NEIGHBORINFO', 72: 'ATAK_PLUGIN',
  73: 'MAP_REPORT', 74: 'POWERSTRESS', 256: 'PRIVATE', 257: 'ATAK_FORWARDER',
};

export const ROLE_NAMES: Record<number, string> = {
  0: 'CLIENT', 1: 'CLIENT_MUTE', 2: 'ROUTER', 3: 'ROUTER_CLIENT', 4: 'REPEATER',
  5: 'TRACKER', 6: 'SENSOR', 7: 'TAK', 8: 'CLIENT_HIDDEN', 9: 'LOST_AND_FOUND',
  10: 'TAK_TRACKER', 11: 'ROUTER_LATE', 12: 'CLIENT_BASE',
};

const HW = [
  'UNSET', 'TLORA_V2', 'TLORA_V1', 'TLORA_V2_1_1P6', 'TBEAM', 'HELTEC_V2_0', 'TBEAM_V0P7',
  'T_ECHO', 'TLORA_V1_1P3', 'RAK4631', 'HELTEC_V2_1', 'HELTEC_V1', 'LILYGO_TBEAM_S3_CORE',
  'RAK11200', 'NANO_G1', 'TLORA_V2_1_1P8', 'TLORA_T3_S3', 'NANO_G1_EXPLORER', 'NANO_G2_ULTRA',
  'LORA_TYPE', 'WIPHONE', 'WIO_WM1110', 'RAK2560', 'HELTEC_HRU_3601', 'HELTEC_WIRELESS_BRIDGE',
  'STATION_G1', 'RAK11310', 'SENSELORA_RP2040', 'SENSELORA_S3', 'CANARYONE', 'RP2040_LORA',
  'STATION_G2', 'LORA_RELAY_V1', 'NRF52840DK', 'PPR', 'GENIEBLOCKS', 'NRF52_UNKNOWN',
  'PORTDUINO', 'ANDROID_SIM', 'DIY_V1', 'NRF52840_PCA10059', 'DR_DEV', 'M5STACK', 'HELTEC_V3',
  'HELTEC_WSL_V3', 'BETAFPV_2400_TX', 'BETAFPV_900_NANO_TX', 'RPI_PICO',
  'HELTEC_WIRELESS_TRACKER', 'HELTEC_WIRELESS_PAPER', 'T_DECK', 'T_WATCH_S3', 'PICOMPUTER_S3',
  'HELTEC_HT62', 'EBYTE_ESP32_S3', 'ESP32_S3_PICO', 'CHATTER_2', 'HELTEC_WIRELESS_PAPER_V1_0',
  'HELTEC_WIRELESS_TRACKER_V1_0', 'UNPHONE', 'TD_LORAC', 'CDEBYTE_EORA_S3', 'TWC_MESH_V4',
  'NRF52_PROMICRO_DIY', 'RADIOMASTER_900_BANDIT_NANO', 'HELTEC_CAPSULE_SENSOR_V3',
  'HELTEC_VISION_MASTER_T190', 'HELTEC_VISION_MASTER_E213', 'HELTEC_VISION_MASTER_E290',
  'HELTEC_MESH_NODE_T114', 'SENSECAP_INDICATOR', 'TRACKER_T1000_E', 'RAK3172', 'WIO_E5',
  'RADIOMASTER_900_BANDIT', 'ME25LS01_4Y10TD', 'RP2040_FEATHER_RFM95', 'M5STACK_COREBASIC',
  'M5STACK_CORE2', 'RPI_PICO2', 'M5STACK_CORES3', 'SEEED_XIAO_S3', 'MS24SF1', 'TLORA_C6',
  'WISMESH_TAP', 'ROUTASTIC', 'MESH_TAB', 'MESHLINK', 'XIAO_NRF52_KIT', 'THINKNODE_M1',
  'THINKNODE_M2', 'T_ETH_ELITE', 'HELTEC_SENSOR_HUB', 'RESERVED_FRIED_CHICKEN',
  'HELTEC_MESH_POCKET', 'SEEED_SOLAR_NODE', 'NOMADSTAR_METEOR_PRO', 'CROWPANEL',
];
export const hwName = (n: number | null | undefined): string | null => {
  if (n === null || n === undefined) return null;
  if (n === 255) return 'PRIVATE_HW';
  return HW[n] ?? `HW_${n}`;
};

export const nodeIdFromNum = (num: number) => '!' + (num >>> 0).toString(16).padStart(8, '0');
export const nodeNumFromId = (id: string): number | null => {
  const m = /^!?([0-9a-f]{1,8})$/i.exec(id.trim());
  return m ? parseInt(m[1], 16) >>> 0 : null;
};

// ------------------------------------------------------------- messages

export interface Data {
  portnum: number;
  payload: Uint8Array;
  wantResponse: boolean;
  dest: number;
  source: number;
  requestId: number;
  replyId: number;
}

export interface MeshPacket {
  from: number;
  to: number;
  channel: number;
  decoded?: Data;
  encrypted?: Uint8Array;
  id: number;
  rxTime: number;
  rxSnr: number;
  hopLimit: number;
  wantAck: boolean;
  rxRssi: number;
  viaMqtt: boolean;
  hopStart: number;
  pkiEncrypted: boolean;
  nextHop: number;
  relayNode: number;
}

export interface ServiceEnvelope {
  packet?: MeshPacket;
  channelId: string;
  gatewayId: string;
}

export interface User {
  id: string;
  longName: string;
  shortName: string;
  hwModel: number;
  isLicensed: boolean;
  role: number;
  hasPublicKey: boolean;
}

export interface Position {
  latitudeI: number;
  longitudeI: number;
  altitude: number;
  time: number;
  groundSpeed: number;
  satsInView: number;
  precisionBits: number;
}

export interface DeviceMetrics {
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  uptimeSeconds?: number;
}
export interface EnvironmentMetrics {
  temperature?: number;
  relativeHumidity?: number;
  barometricPressure?: number;
}
export interface Telemetry {
  time: number;
  deviceMetrics?: DeviceMetrics;
  environmentMetrics?: EnvironmentMetrics;
}

export interface Neighbor { nodeId: number; snr: number; lastRxTime: number }
export interface NeighborInfo {
  nodeId: number;
  lastSentById: number;
  nodeBroadcastIntervalSecs: number;
  neighbors: Neighbor[];
}

export interface RouteDiscovery {
  route: number[];
  snrTowards: number[];
  routeBack: number[];
  snrBack: number[];
}

export interface MapReport {
  longName: string;
  shortName: string;
  role: number;
  hwModel: number;
  firmwareVersion: string;
  region: number;
  modemPreset: number;
  hasDefaultChannel: boolean;
  latitudeI: number;
  longitudeI: number;
  altitude: number;
  positionPrecision: number;
  numOnlineLocalNodes: number;
}

const each = (fields: Field[], fn: (f: Field) => void) => fields.forEach(fn);

export function decodeData(buf: Uint8Array): Data {
  const d: Data = { portnum: 0, payload: new Uint8Array(), wantResponse: false, dest: 0, source: 0, requestId: 0, replyId: 0 };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: d.portnum = asUint32(f); break;
      case 2: d.payload = asBytes(f); break;
      case 3: d.wantResponse = asBool(f); break;
      case 4: d.dest = asUint32(f); break;
      case 5: d.source = asUint32(f); break;
      case 6: d.requestId = asUint32(f); break;
      case 7: d.replyId = asUint32(f); break;
    }
  });
  return d;
}

export function decodeMeshPacket(buf: Uint8Array): MeshPacket {
  const p: MeshPacket = {
    from: 0, to: 0, channel: 0, id: 0, rxTime: 0, rxSnr: 0, hopLimit: 0, wantAck: false,
    rxRssi: 0, viaMqtt: false, hopStart: 0, pkiEncrypted: false, nextHop: 0, relayNode: 0,
  };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: p.from = asUint32(f); break;
      case 2: p.to = asUint32(f); break;
      case 3: p.channel = asUint32(f); break;
      case 4: p.decoded = decodeData(asBytes(f)); break;
      case 5: p.encrypted = asBytes(f); break;
      case 6: p.id = asUint32(f); break;
      case 7: p.rxTime = asUint32(f); break;
      case 8: p.rxSnr = asFloat(f); break;
      case 9: p.hopLimit = asUint32(f); break;
      case 10: p.wantAck = asBool(f); break;
      case 12: p.rxRssi = asInt32(f); break;
      case 14: p.viaMqtt = asBool(f); break;
      case 15: p.hopStart = asUint32(f); break;
      case 17: p.pkiEncrypted = asBool(f); break;
      case 18: p.nextHop = asUint32(f); break;
      case 19: p.relayNode = asUint32(f); break;
    }
  });
  return p;
}

export function decodeServiceEnvelope(buf: Uint8Array): ServiceEnvelope {
  const e: ServiceEnvelope = { channelId: '', gatewayId: '' };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: e.packet = decodeMeshPacket(asBytes(f)); break;
      case 2: e.channelId = asString(f); break;
      case 3: e.gatewayId = asString(f); break;
    }
  });
  return e;
}

export function decodeUser(buf: Uint8Array): User {
  const u: User = { id: '', longName: '', shortName: '', hwModel: 0, isLicensed: false, role: 0, hasPublicKey: false };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: u.id = asString(f); break;
      case 2: u.longName = asString(f); break;
      case 3: u.shortName = asString(f); break;
      case 5: u.hwModel = asUint32(f); break;
      case 6: u.isLicensed = asBool(f); break;
      case 7: u.role = asUint32(f); break;
      case 8: u.hasPublicKey = asBytes(f).length > 0; break;
    }
  });
  return u;
}

export function decodePosition(buf: Uint8Array): Position {
  const p: Position = { latitudeI: 0, longitudeI: 0, altitude: 0, time: 0, groundSpeed: 0, satsInView: 0, precisionBits: 0 };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: p.latitudeI = asInt32(f); break;
      case 2: p.longitudeI = asInt32(f); break;
      case 3: p.altitude = asInt32(f); break;
      case 4: p.time = asUint32(f); break;
      case 15: p.groundSpeed = asUint32(f); break;
      case 19: p.satsInView = asUint32(f); break;
      case 23: p.precisionBits = asUint32(f); break;
    }
  });
  return p;
}

export function decodeTelemetry(buf: Uint8Array): Telemetry {
  const t: Telemetry = { time: 0 };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: t.time = asUint32(f); break;
      case 2: {
        const m: DeviceMetrics = {};
        each(readFields(asBytes(f)), (g) => {
          switch (g.num) {
            case 1: m.batteryLevel = asUint32(g); break;
            case 2: m.voltage = asFloat(g); break;
            case 3: m.channelUtilization = asFloat(g); break;
            case 4: m.airUtilTx = asFloat(g); break;
            case 5: m.uptimeSeconds = asUint32(g); break;
          }
        });
        t.deviceMetrics = m;
        break;
      }
      case 3: {
        const m: EnvironmentMetrics = {};
        each(readFields(asBytes(f)), (g) => {
          switch (g.num) {
            case 1: m.temperature = asFloat(g); break;
            case 2: m.relativeHumidity = asFloat(g); break;
            case 3: m.barometricPressure = asFloat(g); break;
          }
        });
        t.environmentMetrics = m;
        break;
      }
    }
  });
  return t;
}

export function decodeNeighborInfo(buf: Uint8Array): NeighborInfo {
  const n: NeighborInfo = { nodeId: 0, lastSentById: 0, nodeBroadcastIntervalSecs: 0, neighbors: [] };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: n.nodeId = asUint32(f); break;
      case 2: n.lastSentById = asUint32(f); break;
      case 3: n.nodeBroadcastIntervalSecs = asUint32(f); break;
      case 4: {
        const nb: Neighbor = { nodeId: 0, snr: 0, lastRxTime: 0 };
        each(readFields(asBytes(f)), (g) => {
          if (g.num === 1) nb.nodeId = asUint32(g);
          else if (g.num === 2) nb.snr = asFloat(g);
          else if (g.num === 3) nb.lastRxTime = asUint32(g);
        });
        n.neighbors.push(nb);
        break;
      }
    }
  });
  return n;
}

export function decodeRouteDiscovery(buf: Uint8Array): RouteDiscovery {
  const fields = readFields(buf);
  return {
    route: repeated(fields, 1, 'fixed32'),
    snrTowards: repeated(fields, 2, 'int32'),
    routeBack: repeated(fields, 3, 'fixed32'),
    snrBack: repeated(fields, 4, 'int32'),
  };
}

export function decodeMapReport(buf: Uint8Array): MapReport {
  const m: MapReport = {
    longName: '', shortName: '', role: 0, hwModel: 0, firmwareVersion: '', region: 0, modemPreset: 0,
    hasDefaultChannel: false, latitudeI: 0, longitudeI: 0, altitude: 0, positionPrecision: 0, numOnlineLocalNodes: 0,
  };
  each(readFields(buf), (f) => {
    switch (f.num) {
      case 1: m.longName = asString(f); break;
      case 2: m.shortName = asString(f); break;
      case 3: m.role = asUint32(f); break;
      case 4: m.hwModel = asUint32(f); break;
      case 5: m.firmwareVersion = asString(f); break;
      case 6: m.region = asUint32(f); break;
      case 7: m.modemPreset = asUint32(f); break;
      case 8: m.hasDefaultChannel = asBool(f); break;
      case 9: m.latitudeI = asInt32(f); break;
      case 10: m.longitudeI = asInt32(f); break;
      case 11: m.altitude = asInt32(f); break;
      case 12: m.positionPrecision = asUint32(f); break;
      case 13: m.numOnlineLocalNodes = asUint32(f); break;
    }
  });
  return m;
}


// ------------------------------------------------------------- encoders
// Used by the simulator / tests to produce realistic MQTT traffic.

export function encodeData(d: Partial<Data> & { portnum: number; payload: Uint8Array }): Uint8Array {
  return new Writer()
    .uint32(1, d.portnum).bytes(2, d.payload).bool(3, d.wantResponse)
    .fixed32(4, d.dest).fixed32(5, d.source).fixed32(6, d.requestId).fixed32(7, d.replyId)
    .finish();
}

export function encodeMeshPacket(p: Partial<MeshPacket> & { from: number; to: number; id: number }): Uint8Array {
  const w = new Writer().fixed32(1, p.from).fixed32(2, p.to).uint32(3, p.channel);
  if (p.decoded) w.bytes(4, encodeData(p.decoded));
  if (p.encrypted) w.bytes(5, p.encrypted);
  return w.fixed32(6, p.id).fixed32(7, p.rxTime).float(8, p.rxSnr).uint32(9, p.hopLimit)
    .bool(10, p.wantAck).int32(12, p.rxRssi).bool(14, p.viaMqtt).uint32(15, p.hopStart)
    .uint32(19, p.relayNode).finish();
}

export function encodeServiceEnvelope(packet: Uint8Array, channelId: string, gatewayId: string): Uint8Array {
  return new Writer().bytes(1, packet).string(2, channelId).string(3, gatewayId).finish();
}

export function encodeUser(u: Partial<User>): Uint8Array {
  return new Writer().string(1, u.id).string(2, u.longName).string(3, u.shortName)
    .uint32(5, u.hwModel).uint32(7, u.role).finish();
}

export function encodePosition(p: Partial<Position>): Uint8Array {
  return new Writer().sfixed32(1, p.latitudeI).sfixed32(2, p.longitudeI).int32(3, p.altitude)
    .fixed32(4, p.time).uint32(19, p.satsInView).uint32(23, p.precisionBits).finish();
}

export function encodeTelemetry(t: Telemetry): Uint8Array {
  const w = new Writer().fixed32(1, t.time);
  if (t.deviceMetrics) {
    const m = t.deviceMetrics;
    w.bytes(2, new Writer().uint32(1, m.batteryLevel).float(2, m.voltage).float(3, m.channelUtilization)
      .float(4, m.airUtilTx).uint32(5, m.uptimeSeconds).finish());
  }
  if (t.environmentMetrics) {
    const m = t.environmentMetrics;
    w.bytes(3, new Writer().float(1, m.temperature).float(2, m.relativeHumidity).float(3, m.barometricPressure).finish());
  }
  return w.finish();
}

export function encodeNeighborInfo(n: NeighborInfo): Uint8Array {
  const w = new Writer().uint32(1, n.nodeId).uint32(2, n.lastSentById).uint32(3, n.nodeBroadcastIntervalSecs);
  for (const nb of n.neighbors) {
    w.bytes(4, new Writer().uint32(1, nb.nodeId).float(2, nb.snr).fixed32(3, nb.lastRxTime).finish());
  }
  return w.finish();
}

export function encodeRouteDiscovery(r: RouteDiscovery): Uint8Array {
  return new Writer().packedFixed32(1, r.route).packedInt32(2, r.snrTowards)
    .packedFixed32(3, r.routeBack).packedInt32(4, r.snrBack).finish();
}
