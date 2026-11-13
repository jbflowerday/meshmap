import { useCallback, useMemo, useState } from 'react';
import type { LinkSource, MeshNode } from './types';
import { useMediaQuery, useMesh, useNow } from './lib/useMesh';
import { adjacency, buildEdges, hopDistances, shortestPath } from './lib/graph';
import MapView, { type MapFocus } from './components/MapView';
import NodeList from './components/NodeList';
import NodeDetail from './components/NodeDetail';
import RoutePanel from './components/RoutePanel';
import ActivityFeed from './components/ActivityFeed';
import BottomSheet, { type Snap } from './components/BottomSheet';
import { Legend, MapToolbar, type Filters } from './components/MapOverlays';

type Tab = 'nodes' | 'route' | 'activity';
const TITLE = (import.meta.env.VITE_SITE_TITLE as string | undefined) || 'MeshMap';

export default function App() {
  const mesh = useMesh();
  const now = useNow();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [tab, setTab] = useState<Tab>('nodes');
  const [selected, setSelected] = useState<number | null>(null);
  const [route, setRoute] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  const [shownPath, setShownPath] = useState<number[] | null>(null);
  const [track, setTrack] = useState<[number, number][] | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [snap, setSnap] = useState<Snap>('peek');
  const [sheetH, setSheetH] = useState(0);
  const [filters, setFilters] = useState<Filters>({
    showLinks: true,
    sources: new Set<LinkSource>(['neighbor', 'traceroute', 'direct']),
    linkMaxAgeHours: 24,
    nodeMaxAgeHours: 72,
    colorBy: 'activity',
    showLabels: true,
  });

  const allNodes = useMemo(() => [...mesh.nodes.values()], [mesh.nodes]);
  const edgeMap = useMemo(
    () => buildEdges(mesh.links.values(), { sources: filters.sources, minLastSeen: now - filters.linkMaxAgeHours * 3600 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mesh.links, filters.sources, filters.linkMaxAgeHours, Math.floor(now / 300)],
  );
  const edges = useMemo(() => [...edgeMap.values()], [edgeMap]);
  const adj = useMemo(() => adjacency(edges), [edges]);

  const routePath = useMemo(
    () => (route.from !== null && route.to !== null ? shortestPath(adj, route.from, route.to) : null),
    [adj, route.from, route.to],
  );
  const activePath = shownPath ?? (tab === 'route' && !selected ? routePath : null);
  const hopsFromSelected = useMemo(() => (selected !== null ? hopDistances(adj, selected) : new Map<number, number>()), [adj, selected]);

  const visibleNodes = useMemo(() => {
    const minHeard = now - filters.nodeMaxAgeHours * 3600;
    const keep = new Set(activePath ?? []);
    if (selected !== null) keep.add(selected);
    return allNodes.filter((n) => n.last_heard >= minHeard || keep.has(n.num));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNodes, filters.nodeMaxAgeHours, activePath, selected, Math.floor(now / 60)]);

  const select = useCallback((num: number | null) => {
    setSelected(num);
    setShownPath(null);
    if (num !== null) {
      const n = mesh.nodes.get(num);
      if (n?.lat != null) setFocus({ lat: n.lat, lon: n.lon!, nonce: Date.now() });
      setSnap((s) => (s === 'peek' ? 'half' : s));
    }
  }, [mesh.nodes]);

  const focusNode = useCallback((n: MeshNode) => {
    if (n.lat != null) setFocus({ lat: n.lat, lon: n.lon!, zoom: 14, nonce: Date.now() });
  }, []);

  const onRoute = useCallback((from: number | null, to: number | null) => {
    setRoute((r) => ({ from: from ?? r.from, to: to ?? r.to }));
    setSelected(null);
    setShownPath(null);
    setTab('route');
  }, []);

  const stats = useMemo(() => {
    let active1h = 0;
    let active24h = 0;
    let gateways = 0;
    for (const n of allNodes) {
      if (now - n.last_heard < 3600) active1h++;
      if (now - n.last_heard < 86400) {
        active24h++;
        if (n.is_gateway) gateways++;
      }
    }
    return { total: allNodes.length, active1h, active24h, gateways, links: edges.length };
  }, [allNodes, edges.length, now]);

  // ------------------------------------------------------------------ panels
  const panel = selected !== null ? (
    <NodeDetail
      num={selected}
      node={mesh.nodes.get(selected)}
      nodesByNum={mesh.nodes}
      colorBy={filters.colorBy}
      now={now}
      hopsFromSelected={hopsFromSelected}
      onClose={() => select(null)}
      onSelect={select}
      onFocus={focusNode}
      onShowPath={setShownPath}
      onTrack={setTrack}
      onRoute={onRoute}
      activePath={activePath}
    />
  ) : tab === 'nodes' ? (
    <NodeList nodes={allNodes} colorBy={filters.colorBy} now={now} onSelect={select} />
  ) : tab === 'route' ? (
    <RoutePanel
      nodes={allNodes}
      nodesByNum={mesh.nodes}
      edges={edgeMap}
      from={route.from}
      to={route.to}
      path={routePath}
      traceroutes={mesh.traceroutes}
      activePath={activePath}
      colorBy={filters.colorBy}
      now={now}
      onChange={(from, to) => { setRoute({ from, to }); setShownPath(null); }}
      onShowPath={setShownPath}
      onSelect={select}
    />
  ) : (
    <ActivityFeed packets={mesh.packets} nodesByNum={mesh.nodes} now={now} onSelect={select} />
  );

  const tabs = (
    <div className="flex gap-1 px-4 pb-3" role="tablist">
      {(['nodes', 'route', 'activity'] as Tab[]).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t && selected === null}
          type="button"
          onClick={() => { setTab(t); setSelected(null); setShownPath(null); if (!isDesktop && snap === 'peek') setSnap('half'); }}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
            tab === t && selected === null ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          {t === 'route' ? 'Routes' : t}
        </button>
      ))}
    </div>
  );

  const status = (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-400" title={`Live updates: ${mesh.conn}`}>
      <span className={`size-2 rounded-full ${mesh.conn === 'live' ? 'animate-pulse bg-emerald-400' : mesh.conn === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`} />
      {mesh.conn === 'live' ? 'Live' : mesh.conn === 'connecting' ? 'Connecting' : 'Offline'}
    </span>
  );

  const brand = (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="size-6" />
      <h1 className="text-base font-semibold tracking-tight text-white">{TITLE}</h1>
    </div>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-950 text-slate-100">
      {isDesktop && (
        <aside className="flex w-[390px] shrink-0 flex-col border-r border-slate-800 bg-slate-950">
          <header className="px-4 pt-4 pb-3">
            <div className="flex items-center justify-between">{brand}{status}</div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <MiniStat label="1h" value={stats.active1h} />
              <MiniStat label="24h" value={stats.active24h} />
              <MiniStat label="Links" value={stats.links} />
              <MiniStat label="Gateways" value={stats.gateways} />
            </div>
          </header>
          {selected === null && tabs}
          {panel}
        </aside>
      )}

      <main className="relative min-w-0 flex-1">
        <MapView
          nodes={visibleNodes}
          nodesByNum={mesh.nodes}
          edges={edges}
          showLinks={filters.showLinks}
          showLabels={filters.showLabels}
          colorBy={filters.colorBy}
          selected={selected}
          path={activePath}
          track={track}
          focus={focus}
          fitNonce={fitNonce}
          now={now}
          onSelect={select}
          bottomInset={isDesktop ? 0 : sheetH}
        />

        {!isDesktop && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[900] flex items-start justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 shadow-lg backdrop-blur">
              {brand}
              {status}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute right-3 z-[900] flex flex-col items-end gap-2" style={{ top: isDesktop ? 64 : 'calc(max(0.75rem, env(safe-area-inset-top)) + 52px)' }}>
          <MapToolbar filters={filters} setFilters={setFilters} onFit={() => setFitNonce((n) => n + 1)} />
        </div>

        <div className="pointer-events-none absolute left-3 z-[900]" style={{ bottom: isDesktop ? 24 : sheetH + 12 }}>
          <Legend colorBy={filters.colorBy} showLinks={filters.showLinks} />
        </div>

        {mesh.loaded && mesh.error && (
          <div className="absolute top-20 left-1/2 z-[950] -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-950/90 px-4 py-2 text-sm text-red-200">
            Could not reach the server: {mesh.error}
          </div>
        )}
        {mesh.loaded && !mesh.error && allNodes.length === 0 && (
          <div className="absolute top-1/3 left-1/2 z-[950] w-[min(90%,24rem)] -translate-x-1/2 rounded-xl border border-slate-800 bg-slate-900/95 p-4 text-center text-sm text-slate-300">
            <div className="font-semibold text-white">No nodes yet</div>
            Point a Meshtastic node's MQTT module at this server's broker and nodes will appear here as they are heard.
          </div>
        )}
      </main>

      {!isDesktop && (
        <BottomSheet
          snap={snap}
          setSnap={setSnap}
          onHeight={setSheetH}
          header={
            <>
              <div className="flex items-center justify-between px-4 pb-2 text-xs text-slate-400">
                <span><b className="text-slate-100">{stats.active24h}</b> active · <b className="text-slate-100">{stats.active1h}</b> last hour</span>
                <span><b className="text-slate-100">{stats.links}</b> links · <b className="text-slate-100">{stats.gateways}</b> gw</span>
              </div>
              {selected === null && tabs}
            </>
          }
        >
          {panel}
        </BottomSheet>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 py-1.5">
      <div className="font-mono text-sm text-white">{value}</div>
      <div className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  );
}
