import type { MeshNode } from '../types';

export const nowSec = () => Math.floor(Date.now() / 1000);

export function timeAgo(t: number | null | undefined, now = nowSec()): string {
  if (!t) return 'never';
  const d = Math.max(0, now - t);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function duration(sec: number | null | undefined): string {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** False until the node's NODEINFO (or map report) has been received. */
export const hasName = (n: MeshNode | undefined) => !!(n?.long_name || n?.short_name);

export const nodeName =(n: MeshNode | undefined, fallbackNum?: number) =>
  n?.long_name || n?.short_name || n?.id || (fallbackNum !== undefined ? '!' + (fallbackNum >>> 0).toString(16).padStart(8, '0') : '?');

export const shortName = (n: MeshNode | undefined, fallbackNum?: number) =>
  n?.short_name || (n?.id ?? (fallbackNum !== undefined ? (fallbackNum >>> 0).toString(16).padStart(8, '0') : '????')).slice(-4);

export const hexId = (num: number) => '!' + (num >>> 0).toString(16).padStart(8, '0');

export const fmt = (v: number | null | undefined, digits = 1, unit = '') =>
  v === null || v === undefined ? '—' : `${v.toFixed(digits)}${unit}`;

export const prettyEnum = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');

export const isRouter = (n: MeshNode) => n.role === 2 || n.role === 3 || n.role === 4 || n.role === 11;

// ------------------------------------------------------------------ colors

export type ColorBy = 'activity' | 'hops' | 'role';

export function activityColor(lastHeard: number, now = nowSec()): string {
  const age = now - lastHeard;
  if (age < 3600) return '#34d399'; // emerald-400
  if (age < 6 * 3600) return '#38bdf8'; // sky-400
  if (age < 24 * 3600) return '#a78bfa'; // violet-400
  return '#64748b'; // slate-500
}

export const HOP_COLORS = ['#34d399', '#a3e635', '#facc15', '#fb923c', '#f87171', '#e879f9'];
export function hopColor(h: number | null | undefined): string {
  if (h === null || h === undefined) return '#64748b';
  return HOP_COLORS[Math.min(h, HOP_COLORS.length - 1)];
}

export function roleColor(n: MeshNode): string {
  if (n.is_gateway) return '#f472b6'; // pink
  if (isRouter(n)) return '#fbbf24'; // amber
  if (n.role === 5 || n.role === 10) return '#22d3ee'; // trackers
  if (n.role === 6) return '#a3e635'; // sensor
  return '#60a5fa'; // client
}

export function nodeColor(n: MeshNode, by: ColorBy, now = nowSec()): string {
  if (by === 'hops') return hopColor(n.hops_away);
  if (by === 'role') return roleColor(n);
  return activityColor(n.last_heard, now);
}

export function snrColor(snr: number | null | undefined): string {
  if (snr === null || snr === undefined) return '#94a3b8';
  if (snr >= 5) return '#34d399';
  if (snr >= 0) return '#a3e635';
  if (snr >= -5) return '#facc15';
  if (snr >= -10) return '#fb923c';
  return '#f87171';
}

export function snrLabel(snr: number | null | undefined): string {
  return snr === null || snr === undefined ? '?' : `${snr > 0 ? '+' : ''}${snr.toFixed(1)} dB`;
}
