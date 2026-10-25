'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './status';
import type { Milestone } from '@/lib/escrow/types';

const field = 'h-10 w-full rounded-md border border-pp-border bg-white px-3 text-sm outline-none focus:border-pp-blue focus:ring-2 focus:ring-pp-highlight';

export function NewMilestoneForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [amount, setAmount] = useState('250');
  const [clientName, setClientName] = useState('Lotus Flow Yoga');
  const [clientEmail, setClientEmail] = useState('client@lotusflow.example');
  const [freelancerName, setFreelancerName] = useState('Maya Okafor');
  const [freelancerEmail, setFreelancerEmail] = useState('maya@freelance.example');
  const [threshold, setThreshold] = useState(0.8);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function draft() {
    setError('');
    setDrafting(true);
    try {
      const { criteria: drafted } = await api<{ criteria: string[] }>('/api/escrow/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      });
      if (drafted.length) setCriteria(drafted);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { milestone } = await api<{ milestone: Milestone }>('/api/escrow/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, amount, currency: 'USD',
          criteria: criteria.map((c) => c.trim()).filter(Boolean),
          clientName, clientEmail, freelancerName, freelancerEmail, releaseThreshold: threshold,
        }),
      });
      router.push(`/m/${milestone.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <label className="block text-sm font-medium">
          What needs to be done?
          <input className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Landing page for a yoga studio" required minLength={3} />
        </label>
        <label className="block text-sm font-medium">
          Amount (USD)
          <input className={`${field} mt-1`} type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Details
        <textarea className={`${field} mt-1 h-24 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One page, class schedule, contact form to hello@lotusflow.example, must look good on phones…" />
      </label>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Acceptance criteria <span className="font-normal text-pp-muted">· the AI releases the money only when all are verified</span></span>
          <button type="button" onClick={draft} disabled={drafting || title.trim().length < 3} className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
            {drafting ? 'Claude is drafting…' : '✦ Draft with AI'}
          </button>
        </div>
        <ol className="mt-2 space-y-2">
          {criteria.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-pp-muted">{i + 1}.</span>
              <input className={field} value={c} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Page is live at a public URL" />
              <button type="button" aria-label="Remove criterion" onClick={() => setCriteria(criteria.length > 1 ? criteria.filter((_, j) => j !== i) : [''])} className="px-2 text-pp-muted hover:text-pp-danger">×</button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setCriteria([...criteria, ''])} className="mt-2 text-xs font-semibold text-pp-blue hover:underline">+ Add criterion</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="rounded-lg border border-pp-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-pp-muted">Client (pays)</legend>
          <input className={field} value={clientName} onChange={(e) => setClientName(e.target.value)} aria-label="Client name" />
          <input className={`${field} mt-2`} type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} aria-label="Client email" />
        </fieldset>
        <fieldset className="rounded-lg border border-pp-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-pp-muted">Freelancer (gets paid)</legend>
          <input className={field} value={freelancerName} onChange={(e) => setFreelancerName(e.target.value)} aria-label="Freelancer name" />
          <input className={`${field} mt-2`} type="email" value={freelancerEmail} onChange={(e) => setFreelancerEmail(e.target.value)} aria-label="Freelancer PayPal email" />
        </fieldset>
      </div>

      <label className="block text-sm font-medium">
        Release threshold: <span className="font-semibold text-pp-blue">{Math.round(threshold * 100)}%</span>
        <span className="font-normal text-pp-muted"> · minimum AI confidence per criterion before money can move</span>
        <input type="range" min="0.5" max="0.95" step="0.05" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-2 w-full accent-[var(--pp-blue)]" />
      </label>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-pp-danger">{error}</p>}
      <button disabled={saving} className="h-11 w-full rounded-full bg-pp-blue text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60">
        {saving ? 'Creating…' : 'Create milestone → fund it with PayPal'}
      </button>
    </form>
  );
}
