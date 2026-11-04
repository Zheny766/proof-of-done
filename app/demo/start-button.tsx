'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/components/status';

/** Creates a private demo deal and opens it as the freelancer, with the client's key kept too. */
// primary: the electric main action; light: white, for dark panels; outline: for the smaller cards.
const TONES = {
  primary: 'bg-pod-electric text-white hover:bg-pod-electric-dark',
  light: 'bg-white text-pod-midnight hover:bg-pod-mint',
  outline: 'bg-white text-pp-navy ring-1 ring-inset ring-pp-border hover:ring-pod-electric',
};

export function StartDemo({ scenario, label, className = 'mt-5 h-11 w-full text-sm', tone = 'primary' }: { scenario: string; label: string; className?: string; tone?: keyof typeof TONES }) {
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
        className={`inline-flex items-center justify-center rounded-full px-5 font-semibold disabled:opacity-60 ${TONES[tone]} ${className}`}
      >
        {busy ? 'Setting it up…' : label}
      </button>
      {error && <p className="mt-2 text-xs text-pp-danger">{error}</p>}
    </>
  );
}
