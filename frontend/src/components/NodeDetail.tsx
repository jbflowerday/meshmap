import { useEffect, useMemo, useState } from 'react';
import type { LinkSource, MeshNode, NodeDetail as Detail, Traceroute } from '../types';
import { api } from '../lib/api';
import {
  duration, fmt, hasName, hexId, hopColor, nodeColor, nodeName, prettyEnum, snrColor, snrLabel, timeAgo, type ColorBy,
} from '../lib/format';
import { Chip, Empty, HopsBadge, NodeTag, Section, Sparkline, Stat } from './ui';

interface Props {
  num: number;
  node: MeshNode | undefined;
  nodesByNum: Map<number, MeshNode>;
  colorBy: ColorBy;
  now: number;
  hopsFromSelected: Map<number, number>;
  onClose: () => void;
  onSelect: (num: number) => void;
  onFocus: (n: MeshNode) => void;
  onShowPath: (path: number[] | null) => void;
  onTrack: (track: [number, number][] | null) => void;
  onRoute: (from: number | null, to: number | null) => void;
  activePath: number[] | null;
}

const SOURCE_LABEL: Record<LinkSource, string> = { neighbor: 'NeighborInfo', traceroute: 'Traceroute', direct: 'Direct RX' };

export default function NodeDetail(p: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrack, setShowTrack] = useState(false);
  const n = p.node ?? detail?.node;

  // Refetch history when the node is heard again.
  useEffect(() => {
    let cancelled = false;
    api.node(p.num).then(
      (d) => { if (!cancelled) { setDetail(d); setError(null); } },
      (e: Error) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [p.num, p.node?.last_heard]);

  useEffect(() => { setShowTrack(false); setDetail(null); }, [p.num]);

  useEffect(() => {
    if (showTrack && detail && detail.positions.length > 1) p.onTrack(detail.positions.map((x) => [x.lat, x.lon]));
    else p.onTrack(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTrack, detail]);
  useEffect(() => () => p.onTrack(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const neighbors = useMemo(() => {
    if (!detail) return [];
    const m = new Map<number, { other: number; theyHeardMe: number | null; iHeardThem: number | null; sources: Set<LinkSource>; last: number }>();
    for (const l of detail.links) {
      const other = l.from_num === p.num ? l.to_num : l.from_num;
      let e = m.get(other);
      if (!e) m.set(other, (e = { other, theyHeardMe: null, iHeardThem: null, sources: new Set(), last: 0 }));
      e.sources.add(l.source);
      e.last = Math.max(e.last, l.last_seen);
      if (l.snr !== null) {
        if (l.from_num === p.num) e.theyHeardMe = Math.max(e.theyHeardMe ?? -99, l.snr);
        else e.iHeardThem = Math.max(e.iHeardThem ?? -99, l.snr);
      }
    }
    return [...m.values()].sort((a, b) => (b.iHeardThem ?? -99) - (a.iHeardThem ?? -99));
  }, [detail, p.num]);

  const reach = useMemo(() => {
    const counts = [0, 0, 0, 0];
    for (const [num, d] of p.hopsFromSelected) if (num !== p.num && d <= 3) counts[d]++;
    return counts;
  }, [p.hopsFromSelected, p.num]);

  if (!n) {
    return (
      <div className="p-4">
        <BackButton onClick={p.onClose} />
        <div className="mt-6 text-sm text-slate-500">{error ? `Could not load node: ${error}` : 'Loading…'}</div>
      </div>
    );
  }

  const tel = detail?.telemetry ?? [];
  const gw = n.last_gateway !== null ? p.nodesByNum.get(n.last_gateway) : undefined;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-8">
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-slate-950/95 px-4 py-2 backdrop-blur">
        <BackButton onClick={p.onClose} />
        <div className="ml-auto flex gap-1.5">
          {n.lat !== null && (
            <button type="button" onClick={() => p.onFocus(n)} className="rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">
              Center
            </button>
          )}
          <button type="button" onClick={() => p.onRoute(n.num, null)} className="rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">
            Route from
          </button>
          <button type="button" onClick={() => p.onRoute(null, n.num)} className="rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">
            Route to
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-start gap-3">
        <NodeTag node={n} num={n.num} color={nodeColor(n, p.colorBy, p.now)} />
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-semibold break-words text-white">{nodeName(n)}</h2>
          <div className="mt-0.5 font-mono text-xs text-slate-500">{n.id} · {n.num}</div>
        </div>
      </div>

      {!hasName(n) && (
        <div className="mt-3 rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-3 py-2 text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">Name not received yet.</span> Nodes broadcast their name (NODEINFO) about
          every 3 hours and shortly after they reboot. To get it now, open this node in the Meshtastic app on a device whose
          mesh reaches a gateway and use <span className="text-slate-300">Exchange user info</span>.
          {detail?.name_request && !detail.name_request.answered_at && (
            <div className="mt-1.5 text-emerald-300/90">
              MeshMap asked this node for its name {timeAgo(detail.name_request.last_sent, p.now)}
              {detail.name_request.attempts > 1 ? ` (attempt ${detail.name_request.attempts})` : ''}.
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {n.role_name && <Chip>{prettyEnum(n.role_name)}</Chip>}
        {n.hw_model_name && <Chip>{prettyEnum(n.hw_model_name)}</Chip>}
        {n.is_gateway ? <Chip color="#f472b6">MQTT gateway{n.gateway_status ? ` · ${n.gateway_status}` : ''}</Chip> : null}
        {n.via_mqtt ? <Chip color="#94a3b8">via MQTT</Chip> : null}
        {n.firmware && <Chip>fw {n.firmware}</Chip>}
        {n.is_licensed ? <Chip>licensed</Chip> : null}
        {n.has_public_key ? <Chip title="Has PKI public key">🔑 PKI</Chip> : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Last heard" value={timeAgo(n.last_heard, p.now)} />
        <Stat
          label="Hops away"
          value={
            n.hops_away === null ? '—' : (
              <span style={{ color: hopColor(n.hops_away) }}>
                {n.hops_away === 0 ? 'Direct' : `${n.hops_away} hop${n.hops_away === 1 ? '' : 's'}`}
              </span>
            )
          }
          sub={gw || n.last_gateway !== null ? (
            <button type="button" className="truncate text-[11px] text-slate-400 hover:text-emerald-300" onClick={() => n.last_gateway !== null && p.onSelect(n.last_gateway)}>
              via {nodeName(gw, n.last_gateway ?? undefined)}
            </button>
          ) : undefined}
        />
        <Stat label="Battery" value={n.battery === null ? '—' : n.battery > 100 ? 'Powered' : `${n.battery}%`}
          sub={<Sparkline values={tel.map((t) => t.battery)} />} />
        <Stat label="Voltage" value={fmt(n.voltage, 2, ' V')} sub={<Sparkline values={tel.map((t) => t.voltage)} color="#38bdf8" />} />
        <Stat label="Channel util" value={fmt(n.channel_util, 1, '%')} sub={<Sparkline values={tel.map((t) => t.channel_util)} color="#facc15" />} />
        <Stat label="Air util TX" value={fmt(n.air_util_tx, 2, '%')} sub={<Sparkline values={tel.map((t) => t.air_util_tx)} color="#fb923c" />} />
        <Stat label="Uptime" value={duration(n.uptime)} />
        <Stat label="Packets" value={n.packet_count.toLocaleString()} />
        {n.snr !== null && <Stat label="Gateway SNR" value={<span style={{ color: snrColor(n.snr) }}>{snrLabel(n.snr)}</span>} />}
        {n.rssi !== null && <Stat label="Gateway RSSI" value={`${n.rssi} dBm`} />}
        {n.temperature !== null && <Stat label="Temperature" value={fmt(n.temperature, 1, ' °C')} sub={<Sparkline values={tel.map((t) => t.temperature)} color="#f87171" />} />}
        {n.humidity !== null && <Stat label="Humidity" value={fmt(n.humidity, 0, '%')} />}
        {n.pressure !== null && <Stat label="Pressure" value={fmt(n.pressure, 1, ' hPa')} />}
        {n.online_local_nodes !== null && <Stat label="Nodes in view" value={n.online_local_nodes} />}
      </div>

      <Section title="Position">
        {n.lat === null ? (
          <Empty>No position reported.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
            <div className="font-mono">{n.lat.toFixed(5)}, {n.lon!.toFixed(5)}{n.alt !== null ? ` · ${n.alt} m` : ''}</div>
            <div className="mt-1 flex items-center justify-between text-slate-500">
              <span>
                {n.precision_bits && n.precision_bits < 32 ? `Precision ${n.precision_bits} bits (approximate)` : 'Precise'}
                {n.sats_in_view ? ` · ${n.sats_in_view} sats` : ''}
              </span>
              {detail && detail.positions.length > 1 && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" className="accent-cyan-400" checked={showTrack} onChange={(e) => setShowTrack(e.target.checked)} />
                  Track ({detail.positions.length})
                </label>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title={`RF neighbors (${neighbors.length})`}
        right={<span className="text-[10px] text-slate-500">SNR they→me / me→they</span>}
      >
        {neighbors.length === 0 ? (
          <Empty>No links known yet. Links come from NeighborInfo, traceroutes and direct gateway reception.</Empty>
        ) : (
          <ul className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
            {neighbors.map((nb) => {
              const other = p.nodesByNum.get(nb.other);
              return (
                <li key={nb.other}>
                  <button type="button" onClick={() => p.onSelect(nb.other)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/40">
                    <NodeTag node={other} num={nb.other} color={other ? nodeColor(other, p.colorBy, p.now) : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{nodeName(other, nb.other)}</div>
                      <div className="truncate text-[10px] text-slate-500">
                        {[...nb.sources].map((s) => SOURCE_LABEL[s]).join(', ')} · {timeAgo(nb.last, p.now)}
                      </div>
                    </div>
                    <div className="text-right font-mono text-[11px] leading-4">
                      <div style={{ color: snrColor(nb.iHeardThem) }} title="SNR when this node heard the neighbor">{snrLabel(nb.iHeardThem)}</div>
                      <div style={{ color: snrColor(nb.theyHeardMe) }} title="SNR when the neighbor heard this node">{snrLabel(nb.theyHeardMe)}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {neighbors.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-slate-400">
            {[1, 2, 3].map((h) => (
              <div key={h} className="rounded-md border border-slate-800 py-1.5">
                <div className="font-mono text-sm" style={{ color: hopColor(h - 1) }}>{reach[h]}</div>
                nodes at {h} hop{h > 1 ? 's' : ''}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Traceroutes">
        {detail?.traceroute_request && !detail.traceroute_request.answered_at && (
          <div className="mb-2 text-xs text-emerald-300/90">
            MeshMap sent a traceroute to this node {timeAgo(detail.traceroute_request.last_sent, p.now)}; waiting for the reply.
          </div>
        )}
        {!detail ? (
          <Empty>Loading…</Empty>
        ) : detail.traceroutes.length === 0 ? (
          <Empty>No traceroutes involving this node.</Empty>
        ) : (
          <ul className="space-y-2">
            {detail.traceroutes.map((t) => (
              <TracerouteItem key={t.id} t={t} nodesByNum={p.nodesByNum} now={p.now} highlight={p.num}
                active={!!p.activePath && p.activePath.join() === t.route.join()} onShow={p.onShowPath} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent packets">
        {!detail || detail.packets.length === 0 ? (
          <Empty>{detail ? 'None in retention window.' : 'Loading…'}</Empty>
        ) : (
          <ul className="space-y-1 font-mono text-[11px]">
            {detail.packets.slice(0, 25).map((pk) => {
              const sent = pk.from_num === p.num;
              const hops = pk.hop_start ? (pk.hop_start ?? 0) - (pk.hop_limit ?? 0) : null;
              return (
                <li key={pk.id} className="flex gap-2 text-slate-400">
                  <span className="w-14 shrink-0 text-slate-600">{timeAgo(pk.time, p.now)}</span>
                  <span className={`w-28 shrink-0 truncate ${pk.portnum === null ? 'text-slate-600' : 'text-slate-300'}`}>{pk.port}</span>
                  <span className="truncate">
                    {sent ? '' : `uplinked ${hexId(pk.from_num ?? 0)} `}
                    {hops !== null && sent ? `${hops}h ` : ''}
                    {pk.gateway !== null && sent ? `→ ${nodeName(p.nodesByNum.get(pk.gateway), pk.gateway)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="mt-6 text-[11px] text-slate-600">First seen {timeAgo(n.first_seen, p.now)}</div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-slate-400 hover:text-white">
      <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
      </svg>
      Back
    </button>
  );
}

export function TracerouteItem({ t, nodesByNum, now, onShow, active, highlight }: {
  t: Traceroute; nodesByNum: Map<number, MeshNode>; now: number; onShow: (p: number[] | null) => void; active: boolean; highlight?: number;
}) {
  const hops = t.route.length - 2;
  const renderPath = (path: number[], snrs: (number | null)[] | null | undefined) => (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {path.map((num, i) => {
        const nd = nodesByNum.get(num);
        const unknown = num === 0xffffffff;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span className="font-mono text-[9px]" style={{ color: snrColor(snrs?.[i - 1]) }}>
                {snrs?.[i - 1] != null ? `${snrs[i - 1]! > 0 ? '+' : ''}${snrs[i - 1]!.toFixed(0)}` : ''}→
              </span>
            )}
            <span className={`rounded px-1 font-mono text-[11px] ${num === highlight ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-200'}`}>
              {unknown ? '???' : nd?.short_name ?? hexId(num).slice(-4)}
            </span>
          </span>
        );
      })}
    </div>
  );
  return (
    <li>
      <button
        type="button"
        onClick={() => onShow(active ? null : t.route)}
        className={`w-full rounded-lg border px-3 py-2 text-left transition ${active ? 'border-fuchsia-400/60 bg-fuchsia-500/10' : 'border-slate-800 hover:bg-slate-800/40'}`}
      >
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <HopsBadge hops={hops} /> traceroute
          </span>
          <span>{timeAgo(t.time, now)}</span>
        </div>
        {renderPath(t.route, t.snr_towards)}
        {t.route_back && (
          <div className="mt-1.5 border-t border-slate-800 pt-1.5">
            <div className="mb-1 text-[10px] text-slate-600">return</div>
            {renderPath(t.route_back, t.snr_back)}
          </div>
        )}
      </button>
    </li>
  );
}
