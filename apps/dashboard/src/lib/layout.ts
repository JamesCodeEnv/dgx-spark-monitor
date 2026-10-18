import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * Responsive two-column grid used by every page.
 *
 * `repeat(auto-fit, minmax(min(100%, 460px), 1fr))` keeps two columns on a
 * desktop (the 1400px container is too narrow for three) and collapses to one
 * as soon as the container is narrower than ~934px; `min(100%, …)` prevents
 * the column from ever exceeding the container — the fix for charts forcing
 * the page wider than the viewport.
 */
export const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))',
  gap: 14,
  minWidth: 0,
};

/** A wrapping row of cards / badges. */
export const CARD_ROW: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  minWidth: 0,
};

/** Current viewport width, updated on resize (for header/mobile layout). */
export function useViewportWidth(): number {
  const [w, setW] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth
  );
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}
