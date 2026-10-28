'use client';

import dynamic from 'next/dynamic';

// AG Grid is most of the home page's JavaScript and the grid sits at the bottom, so it loads after
// the page instead of with it (the page reads and works before it arrives).
export const MilestonesGridLazy = dynamic(() => import('./milestones-grid').then((m) => m.MilestonesGrid), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-xl border border-pp-border bg-white" aria-label="Loading the deals" />,
});
