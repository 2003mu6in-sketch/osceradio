import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { imageUrl } from "../data/content.ts";

/** Full-screen image viewer: pinch / wheel / double-tap zoom, drag to pan, arrows to switch images. */
export function ImageViewer({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => setView({ s: 1, x: 0, y: 0 }), [i]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((n) => Math.min(images.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      if (e.key === "+" || e.key === "=") setView((v) => ({ ...v, s: Math.min(6, v.s * 1.25) }));
      if (e.key === "-") setView((v) => ({ ...v, s: Math.max(1, v.s / 1.25) }));
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [images.length, onClose]);

  const clamp = (s: number) => Math.min(6, Math.max(1, s));
  const onPointerDown = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const s = clamp(pinch.current.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d);
      setView((v) => ({ ...v, s }));
    } else if (view.s > 1) {
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    setView((v) => (v.s <= 1.01 ? { s: 1, x: 0, y: 0 } : v));
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div className="viewer-bar">
        <span>{images.length > 1 ? `Image ${i + 1} of ${images.length}` : "Pinch or scroll to zoom"}</span>
        <span style={{ display: "flex", gap: 8 }}>
          {images.length > 1 && <>
            <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} aria-label="Previous image">‹</button>
            <button onClick={() => setI((n) => Math.min(images.length - 1, n + 1))} disabled={i === images.length - 1} aria-label="Next image">›</button>
          </>}
          <button onClick={() => setView({ s: 1, x: 0, y: 0 })}>Fit</button>
          <button ref={closeRef} onClick={onClose}>Close</button>
        </span>
      </div>
      <div
        className="viewer-stage"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onWheel={(e) => setView((v) => ({ ...v, s: clamp(v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)) }))}
        onDoubleClick={() => setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { ...v, s: 2.5 }))}
      >
        <img
          src={imageUrl(images[i])} alt={`Image ${i + 1}`} draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        />
      </div>
    </div>
  );
}
