import type { MeshNode, PacketRow } from '../types';
import { hexId, timeAgo } from '../lib/format';
import { Empty, HopsBadge } from './ui';

const PORT_COLOR: Record<string, string> = {
  POSITION: '#38bdf8', NODEINFO: '#a78bfa', TELEMETRY: '#34d399', NEIGHBORINFO: '#fbbf24',
  TRACEROUTE: '#f0abfc', TEXT_MESSAGE: '#f472b6', MAP_REPORT: '#22d3ee', ROUTING: '#94a3b8', ENCRYPTED: '#475569',
};

export default function ActivityFeed({ packets, nodesByNum, now, onSelect }: {
  packets: PacketRow[]; nodesByNum: Map<number, MeshNode>; now: number; onSelect: (n: number) => void;
}) {
  if (packets.length === 0) return <div className="p-4"><Empty>Waiting for packets…</Empty></div>;
  return (
    <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-slate-800/80">
      {packets.map((p, i) => {
        const from = p.from_num ?? p.from ?? 0;
        const hops = p.hops ?? (p.hop_start ? p.hop_start - (p.hop_limit ?? 0) : null);
        const n = nodesByNum.get(from);
        const gw = p.gateway !== null ? nodesByNum.get(p.gateway) : undefined;
        return (
          <li key={p.id ?? `${p.time}-${from}-${i}`}>
            <button type="button" onClick={() => onSelect(from)} className="flex w-full items-center gap-3 border-b border-slate-800/60 px-4 py-2 text-left hover:bg-slate-800/40">
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: PORT_COLOR[p.port] ?? '#64748b' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-slate-200">{n?.long_name ?? hexId(from)}</span>
                  <HopsBadge hops={hops} />
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  <span style={{ color: PORT_COLOR[p.port] }}>{p.port.replace(/_/g, ' ')}</span>
                  {p.gateway !== null && <> · via {gw?.short_name ?? hexId(p.gateway).slice(-4)}</>}
                  {p.snr ? <> · {p.snr.toFixed(1)} dB</> : null}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(p.time, now)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
