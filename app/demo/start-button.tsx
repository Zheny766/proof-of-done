'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/components/status';

/** Creates a private demo deal and opens it as the freelancer, with the client's key kept too. */
export function StartDemo({ scenario, label }: { scenario: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const { id, clientKey, freelancerKey } = await api<{ id: string; clientKey: string; freelancerKey: string }>('/api/demo/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scenario }),
            });
            // Same storage the deal page uses: with both keys saved, it offers the role switch.
            try {
              localStorage.setItem(`pod:keys:${id}`, JSON.stringify({ client: clientKey, freelancer: freelancerKey, share: freelancerKey }));
            } catch {}
            router.push(`/m/${id}?key=${freelancerKey}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        disabled={busy}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-pp-navy px-5 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60"
      >
        {busy ? 'Setting it up…' : label}
      </button>
      {error && <p className="mt-2 text-xs text-pp-danger">{error}</p>}
    </>
  );
}
