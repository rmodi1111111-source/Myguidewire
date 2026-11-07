import { useEffect, useRef, useState } from 'react';
import { onBack } from '../lib/platform';
import { Icon } from './Icon';

/**
 * Full-screen picture viewer: pinch / wheel / double-tap / buttons to zoom,
 * drag to pan, swipe down (when not zoomed) or Esc / back to close.
 * Transforms are written straight to the element (no React re-render per frame).
 */
export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const st = useRef({ s: 1, x: 0, y: 0 });
  const [scaleLabel, setScaleLabel] = useState(100);
  const [closing, setClosing] = useState(false);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  useEffect(() => onBack(() => (close(), true)), []);

  useEffect(() => {
    const el = wrap.current!;
    const im = img.current!;
    const MIN = 1;
    const MAX = 8;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; s: number; cx: number; cy: number; x: number; y: number } | null = null;
    let pan: { x: number; y: number; ox: number; oy: number } | null = null;
    let lastTap = 0;
    let swipeDown = 0;

    const apply = (smooth = false) => {
      const { s, x, y } = st.current;
      im.style.transition = smooth ? 'transform 260ms cubic-bezier(.2,.8,.2,1)' : 'none';
      im.style.transform = `translate3d(${x}px, ${y + swipeDown}px, 0) scale(${s})`;
      el.style.setProperty('--dim', String(Math.max(0.2, 1 - Math.abs(swipeDown) / 400)));
      setScaleLabel(Math.round(s * 100));
    };

    const clamp = () => {
      const r = el.getBoundingClientRect();
      const s = st.current.s;
      const w = im.offsetWidth * s;
      const h = im.offsetHeight * s;
      const mx = Math.max(0, (w - r.width) / 2);
      const my = Math.max(0, (h - r.height) / 2);
      st.current.x = Math.min(mx, Math.max(-mx, st.current.x));
      st.current.y = Math.min(my, Math.max(-my, st.current.y));
    };

    /** Zoom to scale `ns` keeping the screen point (px, py) fixed. */
    const zoomAt = (ns: number, px: number, py: number, smooth = false) => {
      const r = el.getBoundingClientRect();
      ns = Math.min(MAX, Math.max(MIN, ns));
      const cx = px - r.left - r.width / 2;
      const cy = py - r.top - r.height / 2;
      const { s, x, y } = st.current;
      st.current.x = cx - ((cx - x) * ns) / s;
      st.current.y = cy - ((cy - y) * ns) / s;
      st.current.s = ns;
      clamp();
      apply(smooth);
    };

    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('button')) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: st.current.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: st.current.x, y: st.current.y };
        pan = null;
      } else {
        pan = { x: e.clientX, y: e.clientY, ox: st.current.x, oy: st.current.y };
        const now = performance.now();
        if (now - lastTap < 300) {
          // double tap: toggle zoom
          lastTap = 0;
          if (st.current.s > 1.05) {
            st.current = { s: 1, x: 0, y: 0 };
            apply(true);
          } else zoomAt(2.5, e.clientX, e.clientY, true);
          pan = null;
        } else lastTap = now;
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ns = Math.min(MAX, Math.max(0.7, (pinch.s * d) / pinch.d));
        const r = el.getBoundingClientRect();
        const cx = pinch.cx - r.left - r.width / 2;
        const cy = pinch.cy - r.top - r.height / 2;
        const mx = (a.x + b.x) / 2 - pinch.cx;
        const my = (a.y + b.y) / 2 - pinch.cy;
        st.current.s = ns;
        st.current.x = cx - ((cx - pinch.x) * ns) / pinch.s + mx;
        st.current.y = cy - ((cy - pinch.y) * ns) / pinch.s + my;
        apply();
      } else if (pan) {
        const dx = e.clientX - pan.x;
        const dy = e.clientY - pan.y;
        if (st.current.s <= 1.01) {
          swipeDown = dy;
          apply();
        } else {
          st.current.x = pan.ox + dx;
          st.current.y = pan.oy + dy;
          clamp();
          apply();
        }
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && pinch) {
        pinch = null;
        if (st.current.s < 1) st.current = { s: 1, x: 0, y: 0 };
        clamp();
        apply(true);
        const rest = [...pointers.values()][0];
        pan = rest ? { x: rest.x, y: rest.y, ox: st.current.x, oy: st.current.y } : null;
        return;
      }
      if (pointers.size === 0) {
        pan = null;
        if (Math.abs(swipeDown) > 120) {
          close();
          return;
        }
        if (swipeDown) {
          swipeDown = 0;
          apply(true);
        }
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomAt(st.current.s * factor, e.clientX, e.clientY);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === '+' || e.key === '=') zoomBy(1.5);
      if (e.key === '-') zoomBy(1 / 1.5);
      if (e.key === '0') reset();
    };
    const r = () => el.getBoundingClientRect();
    const zoomBy = (f: number) => zoomAt(st.current.s * f, r().left + r().width / 2, r().top + r().height / 2, true);
    const reset = () => {
      st.current = { s: 1, x: 0, y: 0 };
      apply(true);
    };
    (el as any)._zoomBy = zoomBy;
    (el as any)._reset = reset;

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, []);

  const call = (name: string, arg?: number) => (wrap.current as any)?.[name]?.(arg);

  return (
    <div className={`viewer ${closing ? 'closing' : ''}`} role="dialog" aria-label="Picture viewer">
      <div className="viewer-stage" ref={wrap}>
        <img ref={img} src={src} alt={alt} draggable={false} />
      </div>
      <div className="viewer-bar">
        <button className="icon-btn" onClick={() => call('_zoomBy', 1 / 1.5)} aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button className="viewer-scale" onClick={() => call('_reset')} aria-label="Reset zoom">
          {scaleLabel}%
        </button>
        <button className="icon-btn" onClick={() => call('_zoomBy', 1.5)} aria-label="Zoom in">
          <Icon name="plus" />
        </button>
      </div>
      <button className="icon-btn viewer-close" onClick={close} aria-label="Close">
        <Icon name="close" />
      </button>
      {alt && <div className="viewer-caption">{alt}</div>}
    </div>
  );
}
