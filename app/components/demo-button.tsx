'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './status';

export function DemoDataButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <button
      title={error || undefined}
      onClick={async () => {
        setBusy(true);
        setError('');
        try {
          await api('/api/escrow/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-md border border-pp-border bg-white px-3 py-1.5 text-xs font-semibold text-pp-muted hover:border-pp-blue hover:text-pp-blue"
    >
      {busy ? 'Loading…' : error ? 'Try again in a minute' : 'Load demo history'}
    </button>
  );
}
