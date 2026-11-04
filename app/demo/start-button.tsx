'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/components/status';

/** Creates a private demo deal and opens it as the freelancer, with the client's key kept too. */
export function StartDemo({ scenario, label, className = 'mt-5 h-11 w-full text-sm' }: { scenario: string; label: string; className?: string }) {
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
            const { id, clientKey, freelancerKey, stageIds } = await api<{ id: string; clientKey: string; freelancerKey: string; stageIds: string[] }>('/api/demo/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scenario }),
            });
            // Same storage the deal page uses: with both keys saved, it offers the role switch.
            try {
              for (const sid of stageIds ?? [id]) localStorage.setItem(`pod:keys:${sid}`, JSON.stringify({ client: clientKey, freelancer: freelancerKey, share: freelancerKey }));
            } catch {}
            router.push(`/m/${id}?key=${freelancerKey}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        disabled={busy}
        className={`inline-flex items-center justify-center rounded-full bg-pod-electric px-5 font-semibold text-white hover:bg-pod-electric-dark disabled:opacity-60 ${className}`}
      >
        {busy ? 'Setting it up…' : label}
      </button>
      {error && <p className="mt-2 text-xs text-pp-danger">{error}</p>}
    </>
  );
}
