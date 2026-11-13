import { useEffect, useRef, useState, type ReactNode } from 'react';

export type Snap = 'peek' | 'half' | 'full';

const PEEK = 118;
const heightFor = (s: Snap, vh: number) => (s === 'peek' ? PEEK : s === 'half' ? Math.round(vh * 0.5) : vh - 56);

/** Mobile bottom sheet with drag-to-snap. Header area is the drag handle. */
export default function BottomSheet({ snap, setSnap, header, children, onHeight }: {
  snap: Snap; setSnap: (s: Snap) => void; header: ReactNode; children: ReactNode; onHeight: (h: number) => void;
}) {
  const [vh, setVh] = useState(() => window.innerHeight);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; t: number } | null>(null);

  useEffect(() => {
    const on = () => setVh(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);

  const target = heightFor(snap, vh);
  const h = drag ?? target;
  useEffect(() => onHeight(Math.min(target, Math.round(vh * 0.5))), [target, vh, onHeight]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,input,select,a')) return;
    start.current = { y: e.clientY, h, t: Date.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const nh = Math.max(PEEK - 30, Math.min(vh - 40, start.current.h - (e.clientY - start.current.y)));
    if (Math.abs(nh - start.current.h) > 4) setDrag(nh);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (drag === null) {
      // tap on handle cycles
      setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    const velocity = dy / Math.max(1, Date.now() - s.t); // px/ms, + = down
    const snaps: Snap[] = ['peek', 'half', 'full'];
    let best: Snap;
    if (Math.abs(velocity) > 0.5) {
      const i = snaps.indexOf(snap);
      best = velocity > 0 ? snaps[Math.max(0, i - 1)] : snaps[Math.min(2, i + 1)];
    } else {
      best = snaps.reduce((a, b) => (Math.abs(heightFor(b, vh) - drag) < Math.abs(heightFor(a, vh) - drag) ? b : a));
    }
    setDrag(null);
    setSnap(best);
  };

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[1000] flex flex-col rounded-t-2xl border-t border-slate-800 bg-slate-950 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] ${drag === null ? 'transition-[height] duration-200 ease-out' : ''}`}
      style={{ height: h, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="shrink-0 touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="flex justify-center pt-2 pb-1">
          <span className="h-1.5 w-10 rounded-full bg-slate-700" />
        </div>
        {header}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
