'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-renders a server page every few seconds while it's visible: the job board and the scoreboard change as agents and visitors act. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
