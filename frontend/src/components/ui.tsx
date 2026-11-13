import type { ReactNode } from 'react';
import type { MeshNode } from '../types';
import { hopColor, shortName } from '../lib/format';

export function Chip({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] font-medium text-slate-300"
      style={color ? { borderColor: color, color } : undefined}
    >
      {children}
    </span>
  );
}

export function NodeTag({ node, num, color }: { node?: MeshNode; num: number; color?: string }) {
  return (
    <span
      className="inline-flex min-w-[2.75rem] justify-center rounded-md border-2 bg-slate-900 px-1.5 font-mono text-[11px] font-semibold leading-5 text-slate-100"
      style={{ borderColor: color ?? '#475569' }}
    >
      {shortName(node, num)}
    </span>
  );
}

export function HopsBadge({ hops }: { hops: number | null | undefined }) {
  if (hops === null || hops === undefined) return null;
  return (
    <span
      className="rounded px-1.5 py-px font-mono text-[10px] font-bold text-slate-950"
      style={{ background: hopColor(hops) }}
      title={hops === 0 ? 'Heard directly by a gateway' : `${hops} hop${hops === 1 ? '' : 's'} from nearest gateway`}
    >
      {hops === 0 ? 'direct' : `${hops} hop${hops === 1 ? '' : 's'}`}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-slate-100">{value}</div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

export function Sparkline({ values, color = '#34d399', height = 22 }: { values: (number | null)[]; color?: string; height?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return null;
  const w = 100;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const span = max - min || 1;
  const n = values.length - 1 || 1;
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${((i / n) * w).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-5 w-full" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">{children}</div>;
}

export function IconButton({ onClick, title, children, active }: { onClick: () => void; title: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`grid size-10 place-items-center rounded-xl border shadow-lg backdrop-blur transition ${
        active ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
