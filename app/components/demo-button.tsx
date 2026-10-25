'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './status';

export function DemoDataButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await api('/api/escrow/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
      className="rounded-md border border-pp-border bg-white px-3 py-1.5 text-xs font-semibold text-pp-muted hover:border-pp-blue hover:text-pp-blue"
    >
      {busy ? 'Loading…' : 'Load demo history'}
    </button>
  );
}
