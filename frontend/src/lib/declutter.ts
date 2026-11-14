import L from 'leaflet';

export interface DeclutterItem {
  num: number;
  lat: number;
  lon: number;
  /** label text shown in the pill, or '' when drawn as a dot */
  label: string;
}

export interface Placed {
  lat: number;
  lon: number;
  /** true when drawn noticeably away from its real position */
  moved: boolean;
}

const CRS = L.CRS.EPSG3857;
/** Nodes closer than this are treated as co-located (same site / rooftop). */
const COLOCATED_M = 30;
const GAP = 3; // px between neighbouring markers
const ITERATIONS = 40;
/** Max distance (px) a label may be pushed to avoid overlapping a different site. */
const MAX_SHIFT = 60;

/** Approximate rendered size (px) of a marker; matches .mm-pill / .mm-dot in index.css. */
function size(label: string): [number, number] {
  if (!label) return [14, 14];
  return [Math.max(30, label.length * 6.7 + 16), 20];
}

function metres(a: DeclutterItem, b: DeclutterItem): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371000;
}

interface Block {
  members: { item: DeclutterItem; dx: number; dy: number }[];
  ox: number; // true centre (px)
  oy: number;
  x: number; // drawn centre (px)
  y: number;
  w: number;
  h: number;
}

/**
 * Lays out markers so they don't sit on top of each other at `zoom`:
 *
 * 1. Co-located nodes (within ~30 m) are always drawn side by side, as a row
 *    or a compact grid centred on their shared spot, in a stable order.
 * 2. When labels are shown, labels of nearby but different sites that still
 *    overlap are nudged apart, at most MAX_SHIFT px, so the geography stays
 *    readable. Dots at low zoom are left where they are.
 *
 * Works in screen pixels, so recompute it whenever the zoom changes.
 */
export function declutter(items: DeclutterItem[], zoom: number): Map<number, Placed> {
  const sorted = [...items].sort((a, b) => a.num - b.num);
  const n = sorted.length;

  // ---- 1. group co-located nodes (union-find)
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byLat = Array.from({ length: n }, (_, i) => i).sort((a, b) => sorted[a].lat - sorted[b].lat);
  const latWindow = COLOCATED_M / 111_000;
  for (let a = 0; a < n; a++) {
    const i = byLat[a];
    for (let b = a + 1; b < n; b++) {
      const j = byLat[b];
      if (sorted[j].lat - sorted[i].lat > latWindow) break;
      if (metres(sorted[i], sorted[j]) <= COLOCATED_M) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(i);
  }

  // ---- 2. lay each group out side by side
  const blocks: Block[] = [];
  for (const idx of groups.values()) {
    const its = idx.map((i) => sorted[i]);
    const pts = its.map((it) => CRS.latLngToPoint(L.latLng(it.lat, it.lon), zoom));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const sizes = its.map((it) => size(it.label));
    const k = its.length;
    const cellW = Math.max(...sizes.map((s) => s[0])) + GAP;
    const cellH = Math.max(...sizes.map((s) => s[1])) + GAP;
    // A single row for small groups, otherwise a grid that's wider than it is tall.
    const cols = k <= 4 ? k : Math.ceil(Math.sqrt(k * 2));
    const rows = Math.ceil(k / cols);
    const members = its.map((item, m) => {
      const r = Math.floor(m / cols);
      const inRow = r === rows - 1 ? k - r * cols : cols;
      const c = m - r * cols;
      return {
        item,
        dx: (c - (inRow - 1) / 2) * cellW,
        dy: (r - (rows - 1) / 2) * cellH,
      };
    });
    blocks.push({
      members, ox: cx, oy: cy, x: cx, y: cy,
      w: k === 1 ? sizes[0][0] : Math.min(k, cols) * cellW - GAP,
      h: rows * cellH - GAP,
    });
  }

  // ---- 3. nudge overlapping labels of different sites apart (labels only)
  const labelled = blocks.filter((b) => b.members.some((m) => m.item.label));
  if (labelled.length > 1) {
    const maxW = Math.max(...labelled.map((b) => b.w));
    for (let iter = 0; iter < ITERATIONS; iter++) {
      let moved = false;
      labelled.sort((a, b) => a.x - b.x);
      for (let a = 0; a < labelled.length; a++) {
        const p = labelled[a];
        for (let b = a + 1; b < labelled.length; b++) {
          const q = labelled[b];
          const dx = q.x - p.x;
          if (dx >= (p.w + maxW) / 2 + GAP) break;
          const minX = (p.w + q.w) / 2 + GAP;
          const minY = (p.h + q.h) / 2 + GAP;
          const dy = q.y - p.y;
          if (dx >= minX || Math.abs(dy) >= minY) continue;
          const penX = minX - Math.abs(dx);
          const penY = minY - Math.abs(dy);
          moved = true;
          // Separate along the axis that needs the smaller move (labels are
          // wide, so this is usually vertical for side-by-side neighbours).
          if (penX < penY) {
            const s = dx >= 0 ? 1 : -1;
            p.x -= (s * penX) / 2;
            q.x += (s * penX) / 2;
          } else {
            const s = dy >= 0 ? 1 : -1;
            p.y -= (s * penY) / 2;
            q.y += (s * penY) / 2;
          }
        }
      }
      for (const b of labelled) {
        const ddx = b.x - b.ox;
        const ddy = b.y - b.oy;
        const d = Math.hypot(ddx, ddy);
        if (d > MAX_SHIFT) {
          b.x = b.ox + (ddx / d) * MAX_SHIFT;
          b.y = b.oy + (ddy / d) * MAX_SHIFT;
        }
      }
      if (!moved) break;
    }
  }

  // ---- 4. back to lat/lon
  const out = new Map<number, Placed>();
  for (const b of blocks) {
    for (const m of b.members) {
      const px = b.x + m.dx;
      const py = b.y + m.dy;
      const truePt = CRS.latLngToPoint(L.latLng(m.item.lat, m.item.lon), zoom);
      const d = Math.hypot(px - truePt.x, py - truePt.y);
      if (d < 0.5) {
        out.set(m.item.num, { lat: m.item.lat, lon: m.item.lon, moved: false });
      } else {
        const ll = CRS.pointToLatLng(L.point(px, py), zoom);
        out.set(m.item.num, { lat: ll.lat, lon: ll.lng, moved: d > 6 });
      }
    }
  }
  return out;
}
