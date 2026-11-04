'use client';

import { useEffect, useState } from 'react';

/**
 * A ref for a widget's box, and whether that box is narrower than `width` px (a phone): the widget
 * then stacks its parts. A callback ref, so a box that only appears once the data has loaded is
 * still watched.
 */
export function useNarrow(width: number) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < width));
    observer.observe(box);
    return () => observer.disconnect();
  }, [box, width]);
  return [setBox, narrow] as const;
}
