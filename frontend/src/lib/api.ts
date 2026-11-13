import type { LinkRow, MeshNode, NodeDetail, PacketRow, Stats, Traceroute } from '../types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  nodes: () => get<MeshNode[]>('/api/nodes'),
  links: () => get<LinkRow[]>('/api/links'),
  traceroutes: (limit = 100) => get<Traceroute[]>(`/api/traceroutes?limit=${limit}`),
  packets: (limit = 100) => get<PacketRow[]>(`/api/packets?limit=${limit}`),
  stats: () => get<Stats>('/api/stats'),
  node: (num: number, hours = 24) => get<NodeDetail>(`/api/nodes/${num}?hours=${hours}`),
};

export function wsUrl(): string {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export interface LiveUpdate {
  type: 'update';
  nodes: MeshNode[];
  links: LinkRow[];
  packets: PacketRow[];
  traceroutes: Traceroute[];
}
