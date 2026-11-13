import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkRow, MeshNode, PacketRow, Traceroute } from '../types';
import { api, wsUrl, type LiveUpdate } from './api';

export type ConnState = 'connecting' | 'live' | 'offline';

export interface MeshState {
  nodes: Map<number, MeshNode>;
  links: Map<string, LinkRow>;
  traceroutes: Traceroute[];
  packets: PacketRow[];
  conn: ConnState;
  loaded: boolean;
  error: string | null;
  /** bumps whenever live data changes, handy for memo deps */
  version: number;
}

const linkKey = (l: LinkRow) => `${l.from_num}:${l.to_num}:${l.source}`;
const MAX_PACKETS = 200;

/** The API returns one row per gateway reception; keep the first copy of each packet. */
function dedupePackets(rows: PacketRow[]): PacketRow[] {
  const seen = new Set<string>();
  return rows.filter((p) => {
    const k = `${p.from_num ?? p.from}:${p.packet_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function useMesh(): MeshState {
  const [state, setState] = useState<MeshState>({
    nodes: new Map(), links: new Map(), traceroutes: [], packets: [], conn: 'connecting', loaded: false, error: null, version: 0,
  });
  const wsRef = useRef<WebSocket | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [nodes, links, traceroutes, packets] = await Promise.all([
        api.nodes(), api.links(), api.traceroutes(100), api.packets(100),
      ]);
      setState((s) => ({
        ...s,
        nodes: new Map(nodes.map((n) => [n.num, n])),
        links: new Map(links.map((l) => [linkKey(l), l])),
        traceroutes,
        packets: dedupePackets(packets),
        loaded: true,
        error: null,
        version: s.version + 1,
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, loaded: true }));
    }
  }, []);

  useEffect(() => {
    void loadAll();
    // Full refresh periodically to pick up pruning and anything missed while offline.
    const t = setInterval(loadAll, 5 * 60_000);
    return () => clearInterval(t);
  }, [loadAll]);

  useEffect(() => {
    let closed = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setState((s) => ({ ...s, conn: 'connecting' }));
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 1000;
        setState((s) => ({ ...s, conn: 'live' }));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as LiveUpdate;
        if (msg.type !== 'update') return;
        setState((s) => {
          const nodes = msg.nodes.length ? new Map(s.nodes) : s.nodes;
          for (const n of msg.nodes) nodes.set(n.num, n);
          const links = msg.links.length ? new Map(s.links) : s.links;
          for (const l of msg.links) links.set(linkKey(l), l);
          const traceroutes = msg.traceroutes.length ? [...msg.traceroutes.reverse(), ...s.traceroutes].slice(0, 100) : s.traceroutes;
          const packets = msg.packets.length ? [...[...msg.packets].reverse(), ...s.packets].slice(0, MAX_PACKETS) : s.packets;
          return { ...s, nodes, links, traceroutes, packets, version: s.version + 1 };
        });
      };
      ws.onclose = () => {
        if (closed) return;
        setState((s) => ({ ...s, conn: 'offline' }));
        timer = setTimeout(() => {
          void loadAll(); // resync after reconnect
          connect();
        }, retry);
        retry = Math.min(retry * 2, 30_000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [loadAll]);

  return state;
}

/** Re-renders every `ms` so relative times ("5m ago") stay fresh. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
