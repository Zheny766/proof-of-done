'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './status';
import type { Milestone } from '@/lib/escrow/types';

type Stage = { title: string; amount: string; criteria: string };

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
  const [objectionHours, setObjectionHours] = useState(0);
  const [toBoard, setToBoard] = useState(false);
  // A project in stages, each with its own amount and criteria, funded and paid one by one.
  const [staged, setStaged] = useState(false);
  const [stages, setStages] = useState<Stage[]>([
    { title: 'First draft', amount: '100', criteria: '' },
    { title: 'Final files', amount: '150', criteria: '' },
  ]);
  const [draftingStage, setDraftingStage] = useState<number | null>(null);
  const setStage = (i: number, patch: Partial<Stage>) => setStages(stages.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  async function draftStage(i: number) {
    setError('');
    setDraftingStage(i);
    try {
      const { criteria: drafted } = await api<{ criteria: string[] }>('/api/escrow/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${title}: ${stages[i].title}`.slice(0, 120), description }),
      });
      if (drafted.length) setStage(i, { criteria: drafted.join('\n') });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDraftingStage(null);
    }
  }
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
      if (staged) {
        const { milestones, clientKey } = await api<{ milestones: Milestone[]; clientKey: string }>('/api/escrow/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title, description, currency: 'USD', clientName, clientEmail, freelancerName, freelancerEmail, releaseThreshold: threshold, objectionHours,
            stages: stages.map((st) => ({ title: st.title, amount: st.amount, criteria: st.criteria.split('\n').map((c) => c.trim()).filter(Boolean) })),
          }),
        });
        router.push(`/m/${milestones[0].id}?key=${clientKey}`);
        return;
      }
      const { milestone, clientKey } = await api<{ milestone: Milestone; clientKey: string }>('/api/escrow/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, amount, currency: 'USD',
          criteria: criteria.map((c) => c.trim()).filter(Boolean),
          clientName, clientEmail, releaseThreshold: threshold, objectionHours,
          ...(toBoard ? { postToBoard: true } : { freelancerName, freelancerEmail }),
        }),
      });
      router.push(`/m/${milestone.id}?key=${clientKey}`);
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
        {staged ? (
          <div className="text-sm font-medium">
            Total (USD)
            <div className="mt-1 flex h-10 items-center rounded-md bg-pp-canvas px-3 tabular-nums">{stages.reduce((sum, st) => sum + (Number(st.amount) || 0), 0).toFixed(2)}</div>
          </div>
        ) : (
          <label className="block text-sm font-medium">
            Amount (USD)
            <input className={`${field} mt-1`} type="number" min="1" max="10000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
        )}
      </div>
      <label className="block text-sm font-medium">
        Details
        <textarea className={`${field} mt-1 h-24 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One page, class schedule, contact form to hello@lotusflow.example, must look good on phones…" />
      </label>

      {staged ? (
        <div>
          <span className="text-sm font-medium">Stages <span className="font-normal text-pp-muted">· each is funded when it starts and paid when the AI verifies its criteria</span></span>
          <ol className="mt-2 space-y-3">
            {stages.map((st, i) => (
              <li key={i} className="rounded-lg border border-pp-border p-3">
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-semibold text-pp-muted">Stage {i + 1}</span>
                  <input className={`${field} min-w-0 flex-1`} value={st.title} onChange={(e) => setStage(i, { title: e.target.value })} aria-label={`Stage ${i + 1} name`} required minLength={3} />
                  <span className="w-28 shrink-0">
                    <input className={field} type="number" min="1" max="10000" step="0.01" value={st.amount} onChange={(e) => setStage(i, { amount: e.target.value })} aria-label={`Stage ${i + 1} amount`} required />
                  </span>
                  {stages.length > 2 && (
                    <button type="button" aria-label={`Remove stage ${i + 1}`} onClick={() => setStages(stages.filter((_, j) => j !== i))} className="px-1 text-pp-muted hover:text-pp-danger">×</button>
                  )}
                </div>
                <textarea className={`${field} mt-2 h-20 py-2`} value={st.criteria} onChange={(e) => setStage(i, { criteria: e.target.value })} aria-label={`Stage ${i + 1} criteria`} placeholder="Acceptance criteria, one per line" required />
                <button type="button" onClick={() => draftStage(i)} disabled={draftingStage !== null || title.trim().length < 3} className="mt-1 text-xs font-semibold text-violet-700 hover:underline disabled:opacity-50">
                  {draftingStage === i ? 'Drafting…' : 'Draft criteria with AI'}
                </button>
              </li>
            ))}
          </ol>
          {stages.length < 6 && (
            <button type="button" onClick={() => setStages([...stages, { title: `Stage ${stages.length + 1}`, amount: '100', criteria: '' }])} className="mt-2 text-xs font-semibold text-pp-blue hover:underline">
              + Add stage
            </button>
          )}
        </div>
      ) : (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Acceptance criteria <span className="font-normal text-pp-muted">· the AI releases the money only when all are verified</span></span>
          <button type="button" onClick={draft} disabled={drafting || title.trim().length < 3} className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </button>
        </div>
        <ol className="mt-2 space-y-2">
          {criteria.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-pp-muted">{i + 1}.</span>
              <input className={field} aria-label={`Acceptance criterion ${i + 1}`} value={c} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Page is live at a public URL" />
              <button type="button" aria-label="Remove criterion" onClick={() => setCriteria(criteria.length > 1 ? criteria.filter((_, j) => j !== i) : [''])} className="px-2 text-pp-muted hover:text-pp-danger">×</button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setCriteria([...criteria, ''])} className="mt-2 text-xs font-semibold text-pp-blue hover:underline">+ Add criterion</button>
      </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-pp-border p-3 text-sm">
        <input type="checkbox" checked={staged} onChange={(e) => { setStaged(e.target.checked); if (e.target.checked) setToBoard(false); }} className="mt-0.5 h-4 w-4 accent-[var(--pp-blue)]" aria-label="Split it into stages" />
        <span>
          <span className="font-medium">Split it into stages, paid one by one</span>
          <span className="block text-pp-muted">For bigger jobs: each stage has its own amount and criteria, is funded when it starts and paid when it passes. You never have more on hold than the current stage.</span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-pp-border p-3 text-sm">
        <input type="checkbox" checked={toBoard} onChange={(e) => { setToBoard(e.target.checked); if (e.target.checked) setStaged(false); }} className="mt-0.5 h-4 w-4 accent-[var(--pp-blue)]" aria-label="Post on the open job board" />
        <span>
          <span className="font-medium">Post it on the open job board</span>
          <span className="block text-pp-muted">No freelancer yet: once PayPal holds the money, any AI agent or person can take the job. Whoever delivers work that passes gets paid.</span>
        </span>
      </label>

      <div className={`grid gap-4 ${toBoard ? '' : 'sm:grid-cols-2'}`}>
        <fieldset className="rounded-lg border border-pp-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-pp-muted">Client (pays)</legend>
          <input className={field} value={clientName} onChange={(e) => setClientName(e.target.value)} aria-label="Client name" />
          <input className={`${field} mt-2`} type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} aria-label="Client email" />
        </fieldset>
        {!toBoard && (
          <fieldset className="rounded-lg border border-pp-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-pp-muted">Freelancer (gets paid)</legend>
            <input className={field} value={freelancerName} onChange={(e) => setFreelancerName(e.target.value)} aria-label="Freelancer name" />
            <input className={`${field} mt-2`} type="email" value={freelancerEmail} onChange={(e) => setFreelancerEmail(e.target.value)} aria-label="Freelancer PayPal email" />
          </fieldset>
        )}
      </div>

      <label className="block text-sm font-medium">
        Release threshold: <span className="font-semibold text-pp-blue">{Math.round(threshold * 100)}%</span>
        <span className="font-normal text-pp-muted"> · minimum AI confidence per criterion before money can move</span>
        <input type="range" min="0.5" max="0.95" step="0.05" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-2 w-full accent-[var(--pp-blue)]" />
      </label>

      <label className="block text-sm font-medium">
        When the AI verifies the work
        <select value={objectionHours} onChange={(e) => setObjectionHours(Number(e.target.value))} className={`${field} mt-1`}>
          <option value={0}>Pay the freelancer right away</option>
          <option value={1}>Give me 1 hour to object first</option>
          <option value={24}>Give me 24 hours to object first</option>
          <option value={48}>Give me 48 hours to object first</option>
        </select>
      </label>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-pp-danger">{error}</p>}
      <button disabled={saving} className="h-11 w-full rounded-full bg-pp-blue text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60">
        {saving ? 'Creating…' : staged ? 'Create the project → fund stage 1 with PayPal' : 'Create milestone → fund it with PayPal'}
      </button>
    </form>
  );
}
