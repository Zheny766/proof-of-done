'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reloadIfStale } from '@/lib/stale-build';

// Anything that throws while rendering a page (e.g. the data file can't be read) ends up here.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!reloadIfStale(error)) console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm font-semibold text-pp-danger">Something went wrong</p>
      <h1 className="mt-2 text-2xl font-bold text-pp-navy">This page couldn&apos;t be loaded</h1>
      <p className="mt-2 max-w-md text-sm text-pp-muted">
        No money moved. Try again; if it keeps happening, the server log has the details{error.digest ? ` (reference ${error.digest})` : ''}.
      </p>
      <div className="mt-6 flex gap-3">
        <button onClick={reset} className="h-10 rounded-full bg-pp-blue px-5 text-sm font-semibold text-white hover:bg-pp-blue-dark">
          Try again
        </button>
        <Link href="/" className="inline-flex h-10 items-center rounded-full border border-pp-border px-5 text-sm font-semibold hover:border-pp-blue">
          Home
        </Link>
      </div>
    </main>
  );
}
