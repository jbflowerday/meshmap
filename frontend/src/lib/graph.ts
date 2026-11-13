import type { Edge, LinkRow, LinkSource } from '../types';

export const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function buildEdges(links: Iterable<LinkRow>, opts: { sources: Set<LinkSource>; minLastSeen: number }): Map<string, Edge> {
  const edges = new Map<string, Edge>();
  for (const l of links) {
    if (!opts.sources.has(l.source) || l.last_seen < opts.minLastSeen) continue;
    const a = Math.min(l.from_num, l.to_num);
    const b = Math.max(l.from_num, l.to_num);
    const key = edgeKey(a, b);
    let e = edges.get(key);
    if (!e) {
      e = { key, a, b, snrAB: null, snrBA: null, sources: new Set(), lastSeen: 0 };
      edges.set(key, e);
    }
    e.sources.add(l.source);
    e.lastSeen = Math.max(e.lastSeen, l.last_seen);
    if (l.snr !== null) {
      // a->b means b heard a
      if (l.from_num === a) e.snrAB = e.snrAB === null ? l.snr : Math.max(e.snrAB, l.snr);
      else e.snrBA = e.snrBA === null ? l.snr : Math.max(e.snrBA, l.snr);
    }
  }
  return edges;
}

export function adjacency(edges: Iterable<Edge>): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const add = (x: number, y: number) => {
    let s = adj.get(x);
    if (!s) adj.set(x, (s = new Set()));
    s.add(y);
  };
  for (const e of edges) {
    add(e.a, e.b);
    add(e.b, e.a);
  }
  return adj;
}

/** BFS shortest path (fewest hops) over known RF links. */
export function shortestPath(adj: Map<number, Set<number>>, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const nb of adj.get(cur) ?? []) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      if (nb === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(prev.get(path[0])!);
        return path;
      }
      queue.push(nb);
    }
  }
  return null;
}

/** Hop distance from `from` to every reachable node. */
export function hopDistances(adj: Map<number, Set<number>>, from: number): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const nb of adj.get(cur) ?? []) {
      if (dist.has(nb)) continue;
      dist.set(nb, dist.get(cur)! + 1);
      queue.push(nb);
    }
  }
  return dist;
}
