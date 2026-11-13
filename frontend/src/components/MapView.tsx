import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  LayersControl, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents,
} from 'react-leaflet';
import type { Edge, MeshNode } from '../types';
import { nodeColor, nodeName, shortName, snrColor, snrLabel, timeAgo, isRouter, type ColorBy } from '../lib/format';

export interface MapFocus {
  lat: number;
  lon: number;
  zoom?: number;
  nonce: number;
}

interface Props {
  nodes: MeshNode[];
  nodesByNum: Map<number, MeshNode>;
  edges: Edge[];
  showLinks: boolean;
  showLabels: boolean;
  colorBy: ColorBy;
  selected: number | null;
  path: number[] | null;
  track: [number, number][] | null;
  focus: MapFocus | null;
  fitNonce: number;
  now: number;
  onSelect: (num: number | null) => void;
  /** pixels of map covered by an overlay at the bottom (mobile sheet) */
  bottomInset: number;
}

const DEFAULT_CENTER: [number, number] = (() => {
  const v = (import.meta.env.VITE_MAP_CENTER as string | undefined)?.split(',').map(Number);
  return v && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : [39.5, -98.35];
})();
const DEFAULT_ZOOM = Number(import.meta.env.VITE_MAP_ZOOM) || 4;

// Default "Dark" layer is standard OSM tiles darkened with a CSS filter (no API key).
// Set VITE_TILE_URL (+ VITE_TILE_ATTRIBUTION) to use your own dark tile provider instead.
const CUSTOM_TILES = !!import.meta.env.VITE_TILE_URL;
const TILE_URL = (import.meta.env.VITE_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = (import.meta.env.VITE_TILE_ATTRIBUTION as string | undefined) ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const canvas = L.canvas({ padding: 0.5, tolerance: window.matchMedia("(pointer: coarse)").matches ? 2 : 5 });
const iconCache = new Map<string, L.DivIcon>();

function nodeIcon(label: string, color: string, opts: { selected: boolean; router: boolean; gateway: boolean; onPath: boolean; labels: boolean }) {
  const key = `${label}|${color}|${opts.selected}|${opts.router}|${opts.gateway}|${opts.onPath}|${opts.labels}`;
  let icon = iconCache.get(key);
  if (icon) return icon;
  const cls = ['mm-node', opts.router && 'mm-router', opts.gateway && 'mm-gateway', opts.selected && 'mm-selected', opts.onPath && 'mm-onpath']
    .filter(Boolean)
    .join(' ');
  const safe = label.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = opts.labels
    ? `<div class="${cls} mm-pill" style="--c:${color}">${safe}</div>`
    : `<div class="${cls} mm-dot" style="--c:${color}"></div>`;
  icon = L.divIcon({ html, className: 'mm-icon', iconSize: [0, 0] });
  iconCache.set(key, icon);
  return icon;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

function ClickAway({ onSelect }: { onSelect: (n: number | null) => void }) {
  useMapEvents({ click: () => onSelect(null) });
  return null;
}

function Controller({ focus, nodes, fitNonce, bottomInset, path, nodesByNum }: {
  focus: MapFocus | null; nodes: MeshNode[]; fitNonce: number; bottomInset: number; path: number[] | null; nodesByNum: Map<number, MeshNode>;
}) {
  const map = useMap();
  const didFit = useRef(false);
  const pad = useMemo(() => ({ paddingTopLeft: L.point(40, 40), paddingBottomRight: L.point(40, 40 + bottomInset) }), [bottomInset]);

  const fitAll = () => {
    const pts = nodes.filter((n) => n.lat !== null && n.lon !== null).map((n) => [n.lat!, n.lon!] as [number, number]);
    if (pts.length === 0) return false;
    map.fitBounds(L.latLngBounds(pts), { ...pad, maxZoom: 13 });
    return true;
  };

  // First load: fit to all nodes once.
  useEffect(() => {
    if (!didFit.current && fitAll()) didFit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  useEffect(() => {
    if (fitNonce) fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  useEffect(() => {
    if (!focus) return;
    const z = Math.max(map.getZoom(), focus.zoom ?? 12);
    // Offset so the point isn't hidden behind the bottom sheet on mobile.
    const target = map.project([focus.lat, focus.lon], z).add([0, bottomInset / 2]);
    map.flyTo(map.unproject(target, z), z, { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Frame a highlighted path.
  useEffect(() => {
    if (!path || path.length < 2) return;
    const pts = path.map((n) => nodesByNum.get(n)).filter((n): n is MeshNode => !!n && n.lat !== null)
      .map((n) => [n.lat!, n.lon!] as [number, number]);
    if (pts.length >= 2) map.flyToBounds(L.latLngBounds(pts), { ...pad, maxZoom: 14, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path?.join(',')]);

  // Leaflet needs a nudge when its container resizes (sidebar / sheet changes).
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);

  return null;
}

export default function MapView(p: Props) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const positioned = useMemo(() => p.nodes.filter((n) => n.lat !== null && n.lon !== null), [p.nodes]);
  const pathSet = useMemo(() => new Set(p.path ?? []), [p.path]);
  const labels = p.showLabels && zoom >= 9;

  const pathSegments = useMemo(() => {
    if (!p.path) return [];
    const segs: [number, number][][] = [];
    for (let i = 0; i + 1 < p.path.length; i++) {
      const a = p.nodesByNum.get(p.path[i]);
      const b = p.nodesByNum.get(p.path[i + 1]);
      if (a?.lat != null && b?.lat != null) segs.push([[a.lat, a.lon!], [b.lat, b.lon!]]);
    }
    return segs;
  }, [p.path, p.nodesByNum]);

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
      className="h-full w-full"
      worldCopyJump
      attributionControl
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Dark">
          <TileLayer
            url={TILE_URL}
            attribution={TILE_ATTRIBUTION}
            className={CUSTOM_TILES ? undefined : 'mm-dark-tiles'}
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Streets">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      <ZoomWatcher onZoom={setZoom} />
      <ClickAway onSelect={p.onSelect} />
      <Controller focus={p.focus} nodes={positioned} fitNonce={p.fitNonce} bottomInset={p.bottomInset} path={p.path} nodesByNum={p.nodesByNum} />

      <Pane name="links" style={{ zIndex: 410 }}>
        {p.showLinks && p.edges.map((e) => {
          const a = p.nodesByNum.get(e.a);
          const b = p.nodesByNum.get(e.b);
          if (a?.lat == null || b?.lat == null) return null;
          const touches = p.selected !== null && (e.a === p.selected || e.b === p.selected);
          const dim = (p.selected !== null && !touches) || (p.path !== null && !touches);
          const known = [e.snrAB, e.snrBA].filter((x): x is number => x !== null);
          const snr = known.length ? Math.min(...known) : null;
          const tracerouteOnly = e.sources.size === 1 && e.sources.has('traceroute');
          return (
            <Polyline
              key={e.key}
              positions={[[a.lat, a.lon!], [b.lat, b.lon!]]}
              pathOptions={{
                color: snrColor(snr),
                weight: touches ? 3.5 : 2,
                opacity: dim ? 0.12 : touches ? 0.95 : 0.55,
                dashArray: tracerouteOnly ? '4 6' : undefined,
                renderer: canvas,
              }}
            >
              <Popup>
                <div className="text-xs leading-relaxed">
                  <div className="font-semibold text-slate-100">{nodeName(a)} ↔ {nodeName(b)}</div>
                  <div>{shortName(a)} heard by {shortName(b)}: <b>{snrLabel(e.snrAB)}</b></div>
                  <div>{shortName(b)} heard by {shortName(a)}: <b>{snrLabel(e.snrBA)}</b></div>
                  <div className="text-slate-400">via {[...e.sources].join(', ')} · {timeAgo(e.lastSeen, p.now)}</div>
                </div>
              </Popup>
            </Polyline>
          );
        })}
      </Pane>

      <Pane name="path" style={{ zIndex: 420 }}>
        {p.track && p.track.length > 1 && (
          <Polyline positions={p.track} pathOptions={{ color: '#22d3ee', weight: 2, opacity: 0.8, dashArray: '2 5' }} />
        )}
        {pathSegments.map((seg, i) => (
          <Polyline key={`o${i}`} positions={seg} pathOptions={{ color: '#0b1120', weight: 9, opacity: 0.9 }} interactive={false} />
        ))}
        {pathSegments.map((seg, i) => (
          <Polyline key={`i${i}`} positions={seg} pathOptions={{ color: '#f0abfc', weight: 4.5, opacity: 1 }} interactive={false} />
        ))}
      </Pane>

      {positioned.map((n) => {
        const color = nodeColor(n, p.colorBy, p.now);
        const sel = n.num === p.selected;
        return (
          <Marker
            key={n.num}
            position={[n.lat!, n.lon!]}
            icon={nodeIcon(labels || sel ? shortName(n) : '', color, {
              selected: sel, router: isRouter(n), gateway: !!n.is_gateway, onPath: pathSet.has(n.num), labels: labels || sel,
            })}
            zIndexOffset={sel ? 1000 : pathSet.has(n.num) ? 500 : isRouter(n) ? 100 : 0}
            eventHandlers={{
              click: (ev) => {
                L.DomEvent.stopPropagation(ev.originalEvent);
                p.onSelect(n.num);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={1}>
              <div className="text-xs">
                <div className="font-semibold">{nodeName(n)}</div>
                <div className="text-slate-400">
                  {n.hops_away !== null ? `${n.hops_away} hop${n.hops_away === 1 ? '' : 's'} · ` : ''}{timeAgo(n.last_heard, p.now)}
                </div>
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
