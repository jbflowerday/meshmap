import { useMemo, useState } from 'react';
import type { Edge, MeshNode, Traceroute } from '../types';
import { edgeKey } from '../lib/graph';
import { nodeColor, nodeName, snrColor, snrLabel, type ColorBy } from '../lib/format';
import { Empty, NodeTag, Section } from './ui';
import { TracerouteItem } from './NodeDetail';

interface Props {
  nodes: MeshNode[];
  nodesByNum: Map<number, MeshNode>;
  edges: Map<string, Edge>;
  from: number | null;
  to: number | null;
  path: number[] | null;
  traceroutes: Traceroute[];
  activePath: number[] | null;
  colorBy: ColorBy;
  now: number;
  onChange: (from: number | null, to: number | null) => void;
  onShowPath: (p: number[] | null) => void;
  onSelect: (num: number) => void;
}

function NodePicker({ label, value, nodes, nodesByNum, onChange }: {
  label: string; value: number | null; nodes: MeshNode[]; nodesByNum: Map<number, MeshNode>; onChange: (n: number | null) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return nodes
      .filter((n) => !t || [n.long_name, n.short_name, n.id].some((s) => s?.toLowerCase().includes(t)))
      .sort((a, b) => b.last_heard - a.last_heard)
      .slice(0, 30);
  }, [q, nodes]);
  const cur = value !== null ? nodesByNum.get(value) : undefined;

  return (
    <div className="relative">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      {value !== null && !open ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
          <NodeTag node={cur} num={value} />
          <span className="min-w-0 flex-1 truncate text-sm">{nodeName(cur, value)}</span>
          <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => { onChange(null); setOpen(true); }}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            autoFocus={open}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search node…"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-base placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none md:text-sm"
          />
          {open && (
            <ul className="scroll-thin absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
              {matches.map((n) => (
                <li key={n.num}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onChange(n.num); setQ(''); setOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800"
                  >
                    <NodeTag node={n} num={n.num} />
                    <span className="truncate">{nodeName(n)}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No match</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function RoutePanel(p: Props) {
  const hops = p.path ? p.path.length - 2 : null;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-8">
      <p className="mb-3 text-xs text-slate-500">
        Find the fewest-hop path between two nodes using links learned from NeighborInfo, traceroutes and direct gateway reception.
      </p>
      <div className="space-y-3">
        <NodePicker label="From" value={p.from} nodes={p.nodes} nodesByNum={p.nodesByNum} onChange={(n) => p.onChange(n, p.to)} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => p.onChange(p.to, p.from)}
            className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400 hover:text-white"
            title="Swap"
          >
            ⇅ swap
          </button>
        </div>
        <NodePicker label="To" value={p.to} nodes={p.nodes} nodesByNum={p.nodesByNum} onChange={(n) => p.onChange(p.from, n)} />
      </div>

      {p.from !== null && p.to !== null && (
        <div className="mt-4">
          {!p.path ? (
            <Empty>No known path between these nodes with the current link filters.</Empty>
          ) : (
            <div className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="font-semibold">{hops === 0 ? 'Direct link' : `${hops} hop${hops === 1 ? '' : 's'}`}</span>
                <span className="text-xs text-slate-500">({p.path.length - 1} RF link{p.path.length === 2 ? '' : 's'})</span>
              </div>
              <ol className="space-y-0">
                {p.path.map((num, i) => {
                  const n = p.nodesByNum.get(num);
                  const next = p.path![i + 1];
                  const e = next !== undefined ? p.edges.get(edgeKey(num, next)) : undefined;
                  const fwd = e ? (e.a === num ? e.snrAB : e.snrBA) : null;
                  return (
                    <li key={num}>
                      <button type="button" onClick={() => p.onSelect(num)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-slate-800/50">
                        <span className="w-4 text-right font-mono text-[10px] text-slate-500">{i}</span>
                        <NodeTag node={n} num={num} color={n ? nodeColor(n, p.colorBy, p.now) : undefined} />
                        <span className="truncate text-sm">{nodeName(n, num)}</span>
                      </button>
                      {next !== undefined && (
                        <div className="ml-[1.6rem] border-l-2 border-dashed border-fuchsia-400/40 py-0.5 pl-4 font-mono text-[10px]" style={{ color: snrColor(fwd) }}>
                          {snrLabel(fwd)}{e ? ` · ${[...e.sources].join(', ')}` : ''}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}

      <Section title="Recent traceroutes">
        {p.traceroutes.length === 0 ? (
          <Empty>No traceroutes yet. Run a traceroute from the Meshtastic app on any node in range of a gateway.</Empty>
        ) : (
          <ul className="space-y-2">
            {p.traceroutes.slice(0, 30).map((t, i) => (
              <TracerouteItem key={t.id ?? `${t.time}-${i}`} t={t} nodesByNum={p.nodesByNum} now={p.now}
                active={!!p.activePath && p.activePath.join() === t.route.join()} onShow={p.onShowPath} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
