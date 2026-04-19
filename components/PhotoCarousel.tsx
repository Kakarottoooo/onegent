"use client";

import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PhotoCarouselProps {
  images: string[];
  alt: string;
  heightClass?: string;
  rounded?: boolean;
  /** Emoji shown when no images are available. Default: 🏨 */
  emptyEmoji?: string;
  /**
   * Extra overlay rendered in the bottom-right of the carousel (not in the
   * lightbox). Useful for a "view more info" external link. The overlay
   * should stopPropagation on click to avoid triggering the lightbox.
   */
  cornerAction?: ReactNode;
}

export default function PhotoCarousel({
  images,
  alt,
  heightClass = "h-40",
  rounded = false,
  emptyEmoji = "🏨",
  cornerAction,
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const valid = useMemo(
    () => images.map((url, i) => ({ url, i })).filter(({ i }) => !broken.has(i)),
    [images, broken],
  );

  // Keep a live reference to valid.length so the key handler always sees the
  // current count, even if it was registered before images loaded/broke.
  const validLenRef = useRef(valid.length);
  useEffect(() => { validLenRef.current = valid.length; }, [valid.length]);

  const stepPrev = useCallback(() => {
    setIndex((i) => {
      const n = Math.max(1, validLenRef.current);
      return (i - 1 + n) % n;
    });
  }, []);

  const stepNext = useCallback(() => {
    setIndex((i) => {
      const n = Math.max(1, validLenRef.current);
      return (i + 1) % n;
    });
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setLightbox(false); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stepPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stepNext(); }
    };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox, stepPrev, stepNext]);

  if (valid.length === 0) {
    return (
      <div
        className={`relative w-full ${heightClass} bg-[var(--card-2)] flex items-center justify-center text-4xl ${rounded ? "rounded-t-xl" : ""}`}
        aria-hidden
      >
        {emptyEmoji}
        {cornerAction && (
          <div className="absolute bottom-2 right-2 z-10">{cornerAction}</div>
        )}
      </div>
    );
  }

  const clamped = Math.min(index, valid.length - 1);
  const current = valid[clamped];
  const showArrows = valid.length > 1;

  function markBroken(i: number) {
    setBroken((s) => {
      const n = new Set(s);
      n.add(i);
      return n;
    });
  }

  return (
    <>
      <div className={`relative w-full ${heightClass} overflow-hidden bg-[var(--card-2)] ${rounded ? "rounded-t-xl" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={alt}
          loading="lazy"
          onClick={() => setLightbox(true)}
          className="w-full h-full object-cover block cursor-zoom-in"
          onError={() => markBroken(current.i)}
        />

        {showArrows && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); stepPrev(); }}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center text-sm transition-colors"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); stepNext(); }}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center text-sm transition-colors"
            >
              ›
            </button>

            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 pointer-events-none">
              {valid.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === clamped ? "bg-white" : "bg-white/45"}`}
                />
              ))}
            </div>

            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/45 text-white text-[10px] font-medium pointer-events-none">
              {clamped + 1}/{valid.length}
            </div>
          </>
        )}

        {cornerAction && (
          <div className="absolute bottom-2 right-2 z-10">{cornerAction}</div>
        )}
      </div>

      {mounted && lightbox && createPortal(
        <div
          className="fixed inset-0 z-[100]"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
        >
          {/* Backdrop — sibling of the content so button clicks never bubble
              here. Clicking the backdrop closes the lightbox. */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            onClick={() => setLightbox(false)}
          />

          {/* Image — centered above the backdrop, not a child of it. */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={alt}
              className="max-w-[92vw] max-h-[82vh] object-contain select-none rounded-lg shadow-2xl pointer-events-auto"
              onError={() => markBroken(current.i)}
            />
          </div>

          {/* Controls — sibling of backdrop, rendered above via z-index. */}
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="Close photo viewer"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-xl transition-colors shadow-lg ring-1 ring-white/20"
          >
            ✕
          </button>

          <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-black/60 text-white text-sm font-medium ring-1 ring-white/20 pointer-events-none">
            {clamped + 1} / {valid.length}
          </div>

          {showArrows && (
            <>
              <button
                type="button"
                onClick={stepPrev}
                aria-label="Previous photo"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-2xl transition-colors shadow-lg ring-1 ring-white/20"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={stepNext}
                aria-label="Next photo"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-2xl transition-colors shadow-lg ring-1 ring-white/20"
              >
                ›
              </button>

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 px-3 py-2 rounded-xl bg-black/50 ring-1 ring-white/10 max-w-[90vw] overflow-x-auto">
                {valid.map(({ url, i }, idx) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIndex(idx)}
                    className={`flex-shrink-0 w-16 h-12 rounded-md overflow-hidden border-2 transition-colors ${idx === clamped ? "border-white" : "border-transparent opacity-60 hover:opacity-100"}`}
                    aria-label={`Photo ${idx + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={() => markBroken(i)}
                    />
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="absolute bottom-2 right-4 text-white/60 text-[11px] pointer-events-none select-none">
            ESC to close · ← → to navigate
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
