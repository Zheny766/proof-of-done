'use client';

// Funding a milestone with PayPal JS SDK v6. The server creates an order with intent AUTHORIZE;
// when the buyer approves in the PayPal window we place the hold (no money moves yet). Without
// sandbox credentials the same two server steps run in simulated mode.

import { useEffect, useRef, useState } from 'react';
import { api } from './status';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-namespace -- the PayPal v6 SDK ships no types; `<paypal-button>` is its web component */
declare global {
  interface Window {
    paypal?: any;
  }
  namespace React.JSX {
    interface IntrinsicElements {
      'paypal-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string };
    }
  }
}

const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

function loadSdk(): Promise<void> {
  if (window.paypal?.createInstance) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src: SDK_URL, async: true });
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load the PayPal SDK')));
    if (!existing) document.head.appendChild(script);
  });
}

export function PayPalFundButton({ milestoneId, clientId, onFunded }: { milestoneId: string; clientId: string | null; onFunded: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'working' | 'error'>(clientId ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const sessionRef = useRef<any>(null);

  const createOrder = () =>
    api<{ orderId: string }>(`/api/escrow/milestones/${milestoneId}/order`, { method: 'POST' }).then(({ orderId }) => ({ orderId }));

  const authorize = async (orderId: string) => {
    setState('working');
    try {
      await api(`/api/escrow/milestones/${milestoneId}/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      onFunded();
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  };

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      try {
        await loadSdk();
        const sdk = await window.paypal.createInstance({ clientId, components: ['paypal-payments'], pageType: 'checkout' });
        sessionRef.current = sdk.createPayPalOneTimePaymentSession({
          onApprove: (data: { orderId: string }) => authorize(data.orderId),
          onCancel: () => setState('ready'),
          onError: (err: Error) => {
            setError(err?.message ?? 'PayPal error');
            setState('error');
          },
        });
        if (!cancelled) setState('ready');
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, milestoneId]);

  async function startPayPal() {
    setError('');
    try {
      await sessionRef.current.start({ presentationMode: 'auto' }, createOrder());
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  async function simulate() {
    setError('');
    setState('working');
    try {
      const { orderId } = await createOrder();
      await authorize(orderId);
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  return (
    <div className="space-y-2">
      {clientId ? (
        <div className={state === 'loading' ? 'pointer-events-none opacity-50' : ''} onClick={startPayPal}>
          <paypal-button type="pay" className="block w-full" />
        </div>
      ) : (
        <button onClick={simulate} disabled={state === 'working'} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ffc439] text-sm font-bold text-[#003087] hover:brightness-95 disabled:opacity-60">
          {state === 'working' ? 'Placing hold…' : <><span className="italic">Pay</span><span className="italic text-[#009cde]">Pal</span><span className="font-medium"> · authorize (simulated)</span></>}
        </button>
      )}
      <p className="text-center text-xs text-pp-muted">
        {state === 'working' ? 'Placing the hold on PayPal…' : 'You approve the full amount now. PayPal holds it; it is only charged when the work is verified.'}
      </p>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-pp-danger">{error}</p>}
    </div>
  );
}
