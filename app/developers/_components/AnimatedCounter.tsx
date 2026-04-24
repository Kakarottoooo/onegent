"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  /** Target value the counter animates up to. */
  target: number;
  /** Animation duration in ms. Defaults to 1600. */
  durationMs?: number;
  /** Number of decimal places to render. */
  decimals?: number;
  /** Use thousands separator (12,847). Defaults to true. */
  separator?: boolean;
}

/**
 * Counts up from 0 to target when the element scrolls into view.
 * IntersectionObserver gates the start so the animation plays exactly
 * once per visit. Respects prefers-reduced-motion (jumps to target).
 */
export function AnimatedCounter({
  target,
  durationMs = 1600,
  decimals = 0,
  separator = true,
}: AnimatedCounterProps) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setValue(target);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const elapsed = now - start;
              const t = Math.min(elapsed / durationMs, 1);
              // Ease-out cubic gives a satisfying decel landing.
              const eased = 1 - Math.pow(1 - t, 3);
              setValue(target * eased);
              if (t < 1) requestAnimationFrame(tick);
              else setValue(target);
            };
            requestAnimationFrame(tick);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, durationMs]);

  const formatted =
    decimals > 0
      ? value.toFixed(decimals)
      : separator
        ? Math.round(value).toLocaleString("en-US")
        : String(Math.round(value));

  return <span ref={ref}>{formatted}</span>;
}
