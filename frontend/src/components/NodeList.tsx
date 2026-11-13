import { useMemo, useState } from 'react';
import type { MeshNode } from '../types';
import { nodeColor, nodeName, prettyEnum, timeAgo, type ColorBy } from '../lib/format';
import { HopsBadge, NodeTag } from './ui';

type Sort = 'recent' | 'name' | 'hops' | 'packets';

interface Props {
  nodes: MeshNode[];
  colorBy: ColorBy;
  now: number;
  onSelect: (num: number) => void;
}

const PAGE = 150;

export default function NodeList({ nodes, colorBy, now, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    let l = nodes.filter((n) => (!onlyMapped || n.lat !== null) && (!term ||
      [n.long_name, n.short_name, n.id, n.hw_model_name, n.role_name].some((s) => s?.toLowerCase().includes(term))));
    const by: Record<Sort, (a: MeshNode, b: MeshNode) => number> = {
      recent: (a, b) => b.last_heard - a.last_heard,
      name: (a, b) => nodeName(a).localeCompare(nodeName(b)),
      hops: (a, b) => (a.hops_away ?? 99) - (b.hops_away ?? 99) || b.last_heard - a.last_heard,
      packets: (a, b) => b.packet_count - a.packet_count,
    };
    l = [...l].sort(by[sort]);
    return l;
  }, [nodes, q, sort, onlyMapped]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-4 pb-3">
        <div className="relative">
          <svg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.63 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.63A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
            placeholder="Search name, id, hardware…"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pr-3 pl-9 text-base text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none md:text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-slate-300"
            aria-label="Sort nodes"
          >
            <option value="recent">Last heard</option>
            <option value="name">Name</option>
            <option value="hops">Hops away</option>
            <option value="packets">Packets</option>
          </select>
          <label className="flex items-center gap-1.5 text-slate-400">
            <input type="checkbox" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} className="accent-emerald-500" />
            On map only
          </label>
          <span className="ml-auto text-slate-500">{list.length} nodes</span>
        </div>
      </div>

      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-slate-800/80">
        {list.slice(0, limit).map((n) => (
          <li key={n.num}>
            <button
              type="button"
              onClick={() => onSelect(n.num)}
              className="flex w-full items-center gap-3 border-b border-slate-800/60 px-4 py-2.5 text-left hover:bg-slate-800/40 active:bg-slate-800/60"
            >
              <NodeTag node={n} num={n.num} color={nodeColor(n, colorBy, now)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-slate-100">{nodeName(n)}</span>
                  {n.is_gateway ? <span title="MQTT gateway" className="text-[10px] text-pink-400">GW</span> : null}
                  {n.lat === null && <span title="No position" className="text-[10px] text-slate-600">no pos</span>}
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  {prettyEnum(n.hw_model_name)} · {prettyEnum(n.role_name)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <HopsBadge hops={n.hops_away} />
                <span className="text-[11px] text-slate-500">{timeAgo(n.last_heard, now)}</span>
              </div>
            </button>
          </li>
        ))}
        {list.length > limit && (
          <li className="p-3 text-center">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-xs text-emerald-400 hover:underline">
              Show more ({list.length - limit} remaining)
            </button>
          </li>
        )}
        {list.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No nodes match.</li>}
      </ul>
    </div>
  );
}
