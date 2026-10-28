'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/components/status';

/** A person takes a job from the board: name and PayPal email, then their freelancer link opens. */
export function TakeJob({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = 'h-11 w-full rounded-xl border border-pp-border bg-white px-3.5 text-[15px] outline-none focus:border-pp-blue focus:ring-2 focus:ring-pp-highlight';
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-5 inline-flex h-11 items-center justify-center rounded-full border border-pp-border bg-white px-5 text-sm font-semibold text-pp-ink hover:border-pp-blue">
        Take it yourself
      </button>
    );
  }
  return (
    <form
      className="mt-5 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const { freelancerKey } = await api<{ freelancerKey: string }>(`/api/jobs/${id}/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, payoutEmail: email }),
          });
          // The deal page keeps the key from the link, next to any this browser already has for it
          // (the client's, if the job was posted from here).
          router.push(`/m/${id}?key=${freelancerKey}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" className={field} />
      <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="PayPal email for the payout" aria-label="PayPal email for the payout" className={field} />
      <button disabled={busy} className="inline-flex h-11 w-full items-center justify-center rounded-full bg-pp-navy px-5 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60">
        {busy ? 'Taking it…' : 'Take the job: 24 hours to deliver'}
      </button>
      {error && <p className="text-xs text-pp-danger">{error}</p>}
    </form>
  );
}
