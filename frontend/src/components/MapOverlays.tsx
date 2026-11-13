import { useState } from 'react';
import type { LinkSource } from '../types';
import { HOP_COLORS, type ColorBy } from '../lib/format';
import { IconButton } from './ui';

export interface Filters {
  showLinks: boolean;
  sources: Set<LinkSource>;
  linkMaxAgeHours: number;
  nodeMaxAgeHours: number;
  colorBy: ColorBy;
  showLabels: boolean;
}

export function MapToolbar({ filters, setFilters, onFit }: {
  filters: Filters; setFilters: (f: Filters) => void; onFit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggleSource = (s: LinkSource) => {
    const next = new Set(filters.sources);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setFilters({ ...filters, sources: next });
  };

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <IconButton title="Map settings" onClick={() => setOpen((o) => !o)} active={open}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
          <path d="M10 3.75a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM17.25 4.5a.75.75 0 0 0 0-1.5h-5.5a.75.75 0 0 0 0 1.5h5.5ZM5 3.75a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 .75.75ZM4.25 17a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5h1.5ZM17.25 17a.75.75 0 0 0 0-1.5h-5.5a.75.75 0 0 0 0 1.5h5.5ZM9 10a.75.75 0 0 1-.75.75h-5.5a.75.75 0 0 1 0-1.5h5.5A.75.75 0 0 1 9 10ZM17.25 10.75a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5h1.5ZM14 10a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM10 16.25a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z" />
        </svg>
      </IconButton>
      <IconButton title="Fit all nodes" onClick={onFit}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
          <path d="M3.28 2.22a.75.75 0 0 0-1.06 1.06L5.44 6.5H2.75a.75.75 0 0 0 0 1.5h4.5A.75.75 0 0 0 8 7.25v-4.5a.75.75 0 0 0-1.5 0v2.69L3.28 2.22ZM13.5 2.75a.75.75 0 0 0-1.5 0v4.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-2.69l3.22-3.22a.75.75 0 0 0-1.06-1.06L13.5 5.44V2.75ZM3.28 17.78l3.22-3.22v2.69a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.69l-3.22 3.22a.75.75 0 1 0 1.06 1.06ZM13.5 14.56l3.22 3.22a.75.75 0 1 0 1.06-1.06l-3.22-3.22h2.69a.75.75 0 0 0 0-1.5h-4.5a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0v-2.69Z" />
        </svg>
      </IconButton>

      {open && (
        <div className="w-64 rounded-xl border border-slate-800 bg-slate-900/95 p-3 text-sm shadow-2xl backdrop-blur">
          <Row label="Color nodes by">
            <select
              value={filters.colorBy}
              onChange={(e) => setFilters({ ...filters, colorBy: e.target.value as ColorBy })}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
            >
              <option value="activity">Last heard</option>
              <option value="hops">Hops away</option>
              <option value="role">Role</option>
            </select>
          </Row>
          <Row label="Show nodes heard in">
            <select
              value={filters.nodeMaxAgeHours}
              onChange={(e) => setFilters({ ...filters, nodeMaxAgeHours: Number(e.target.value) })}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
            >
              <option value={1}>1 hour</option>
              <option value={6}>6 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
              <option value={720}>30 days</option>
            </select>
          </Row>
          <Toggle label="Name labels" checked={filters.showLabels} onChange={(v) => setFilters({ ...filters, showLabels: v })} />
          <div className="my-2 border-t border-slate-800" />
          <Toggle label="Show links" checked={filters.showLinks} onChange={(v) => setFilters({ ...filters, showLinks: v })} />
          <div className={filters.showLinks ? '' : 'pointer-events-none opacity-40'}>
            <Toggle small label="NeighborInfo" checked={filters.sources.has('neighbor')} onChange={() => toggleSource('neighbor')} />
            <Toggle small label="Traceroute (dashed)" checked={filters.sources.has('traceroute')} onChange={() => toggleSource('traceroute')} />
            <Toggle small label="Direct to gateway" checked={filters.sources.has('direct')} onChange={() => toggleSource('direct')} />
            <Row label="Links seen in">
              <select
                value={filters.linkMaxAgeHours}
                onChange={(e) => setFilters({ ...filters, linkMaxAgeHours: Number(e.target.value) })}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
              >
                <option value={1}>1 hour</option>
                <option value={6}>6 hours</option>
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
              </select>
            </Row>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, small }: { label: string; checked: boolean; onChange: (v: boolean) => void; small?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between py-1 ${small ? 'pl-3 text-xs text-slate-400' : 'text-xs text-slate-300'}`}>
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-emerald-500" />
    </label>
  );
}

export function Legend({ colorBy, showLinks }: { colorBy: ColorBy; showLinks: boolean }) {
  const [open, setOpen] = useState(() => window.innerWidth >= 768);
  const nodeItems: [string, string][] =
    colorBy === 'hops'
      ? [...HOP_COLORS.map((c, i) => [c, i === 0 ? 'direct' : i === HOP_COLORS.length - 1 ? `${i}+ hops` : `${i} hop${i > 1 ? 's' : ''}`] as [string, string]), ['#64748b', 'unknown']]
      : colorBy === 'role'
        ? [['#f472b6', 'gateway'], ['#fbbf24', 'router'], ['#22d3ee', 'tracker'], ['#a3e635', 'sensor'], ['#60a5fa', 'client']]
        : [['#34d399', '< 1h'], ['#38bdf8', '< 6h'], ['#a78bfa', '< 24h'], ['#64748b', 'older']];
  const snrItems: [string, string][] = [['#34d399', '≥5'], ['#a3e635', '≥0'], ['#facc15', '−5'], ['#fb923c', '−10'], ['#f87171', '<−10']];

  return (
    <div className="pointer-events-auto rounded-xl border border-slate-800 bg-slate-900/90 text-[11px] text-slate-300 shadow-lg backdrop-blur">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 font-semibold text-slate-400">
        Legend <span className="text-slate-600">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-2.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {nodeItems.map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: c }} /> {l}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-slate-400">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border border-slate-400" /> router</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full outline-2 outline-pink-400" /> gateway</span>
          </div>
          {showLinks && (
            <div>
              <div className="mb-1 text-slate-500">Link SNR (dB)</div>
              <div className="flex gap-1">
                {snrItems.map(([c, l]) => (
                  <span key={l} className="flex flex-1 flex-col items-center gap-0.5">
                    <span className="h-1 w-full rounded" style={{ background: c }} />
                    <span className="text-[9px] text-slate-500">{l}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
