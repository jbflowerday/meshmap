export interface MeshNode {
  num: number;
  id: string;
  long_name: string | null;
  short_name: string | null;
  hw_model: number | null;
  hw_model_name: string | null;
  role: number | null;
  role_name: string | null;
  firmware: string | null;
  is_licensed: number | null;
  has_public_key: number | null;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  precision_bits: number | null;
  position_time: number | null;
  sats_in_view: number | null;
  battery: number | null;
  voltage: number | null;
  channel_util: number | null;
  air_util_tx: number | null;
  uptime: number | null;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  region: number | null;
  modem_preset: number | null;
  online_local_nodes: number | null;
  hops_away: number | null;
  snr: number | null;
  rssi: number | null;
  last_gateway: number | null;
  via_mqtt: number | null;
  is_gateway: number | null;
  gateway_status: string | null;
  packet_count: number;
  first_seen: number;
  last_heard: number;
}

export type LinkSource = 'neighbor' | 'traceroute' | 'direct';

/** Directed link as stored by the backend: `to_num` heard `from_num` at `snr`. */
export interface LinkRow {
  from_num: number;
  to_num: number;
  source: LinkSource;
  snr: number | null;
  rssi: number | null;
  count: number;
  first_seen: number;
  last_seen: number;
}

export interface Traceroute {
  id?: number;
  from_num?: number;
  to_num?: number;
  from?: number;
  to?: number;
  route: number[];
  snr_towards?: (number | null)[];
  route_back: number[] | null;
  snr_back?: (number | null)[] | null;
  time: number;
}

export interface PacketRow {
  id?: number;
  packet_id?: number;
  from_num?: number;
  from?: number;
  to_num?: number;
  to?: number;
  portnum: number | null;
  port: string;
  gateway: number | null;
  hop_start?: number;
  hop_limit?: number;
  hops?: number | null;
  snr: number | null;
  rssi: number | null;
  time: number;
}

export interface NodeDetail {
  node: MeshNode;
  links: LinkRow[];
  traceroutes: Traceroute[];
  positions: { time: number; lat: number; lon: number; alt: number | null }[];
  telemetry: {
    time: number; battery: number | null; voltage: number | null; channel_util: number | null;
    air_util_tx: number | null; temperature: number | null; humidity: number | null; pressure: number | null;
  }[];
  packets: PacketRow[];
  /** Present when automatic name requests are enabled and this node has been asked. */
  name_request?: { last_sent: number; attempts: number; gateway: number | null; answered_at: number | null } | null;
  /** Present when scheduled traceroutes are enabled and this node has been traced. */
  traceroute_request?: { last_sent: number; attempts: number; gateway: number | null; answered_at: number | null } | null;
}

export interface Stats {
  nodes: number;
  nodesWithPosition: number;
  active1h: number;
  active24h: number;
  gateways: number;
  links: number;
  packets24h: number;
  traceroutes: number;
}

/** Undirected edge merged from all directed link rows between two nodes. */
export interface Edge {
  key: string;
  a: number;
  b: number;
  /** SNR at b when a transmitted, and vice versa */
  snrAB: number | null;
  snrBA: number | null;
  sources: Set<LinkSource>;
  lastSeen: number;
}
