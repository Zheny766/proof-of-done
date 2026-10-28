'use client';

// PayPal JS SDK v6 button. Server creates an AUTHORIZE order, buyer approves in the popup, then we
// authorize it - money is held, not charged. Without PayPal keys it fakes both steps.

import { useEffect, useRef, useState } from 'react';
import { api, keyHeader } from './status';

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
// One of the card numbers PayPal publishes for sandbox testing. With it anyone can fund a deal as a
// guest, without a sandbox account (checked end to end: authorize, capture, payout).
const TEST_CARD = '4012000033330026';

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

export function PayPalFundButton({
  milestoneId,
  milestoneKey,
  clientId,
  onFunded,
}: {
  milestoneId: string;
  milestoneKey: string | null;
  clientId: string | null;
  onFunded: () => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'working' | 'error'>(clientId ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const sessionRef = useRef<any>(null);

  const createOrder = () =>
    api<{ orderId: string }>(`/api/escrow/milestones/${milestoneId}/order`, { method: 'POST', headers: keyHeader(milestoneKey) }).then(({ orderId }) => ({
      orderId,
    }));

  const authorize = async (orderId: string) => {
    setState('working');
    try {
      await api(`/api/escrow/milestones/${milestoneId}/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...keyHeader(milestoneKey) },
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
        // Otherwise the SDK follows the browser language and the button ends up in Russian on my machine.
        const sdk = await window.paypal.createInstance({ clientId, components: ['paypal-payments'], pageType: 'checkout', locale: 'en-US' });
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
    if (!sessionRef.current || state === 'working') return;
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
        <button onClick={simulate} disabled={state === 'working'} aria-label={state === 'working' ? 'Placing hold' : 'Pay with PayPal: authorize (simulated)'} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ffc439] text-sm font-bold text-[#003087] hover:brightness-95 disabled:opacity-60">
          {state === 'working' ? 'Placing hold…' : <><span className="italic">Pay</span><span className="italic text-[#009cde]">Pal</span><span className="font-medium"> · authorize (simulated)</span></>}
        </button>
      )}
      <p className="text-center text-xs text-pp-muted">
        {state === 'working' ? 'Placing the hold on PayPal…' : 'You approve the full amount now. PayPal holds it; it is only charged when the work is verified.'}
      </p>
      {clientId && <TestCardHint />}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-pp-danger">{error}</p>}
    </div>
  );
}

function TestCardHint() {
  const [copied, setCopied] = useState(false);
  return (
    <p className="rounded-xl bg-pp-canvas px-3.5 py-3 text-xs leading-relaxed text-pp-muted">
      <b className="text-pp-ink">No PayPal sandbox account?</b> In the PayPal window choose <b className="text-pp-ink">Pay with Debit or Credit Card</b> and enter PayPal&apos;s test card{' '}
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(TEST_CARD).then(() => setCopied(true), () => {})}
        title="Copy the card number"
        className="font-mono font-semibold text-pp-ink underline decoration-dotted underline-offset-2 hover:text-pp-blue"
      >
        {TEST_CARD.replace(/(\d{4})(?=\d)/g, '$1 ')}
      </button>
      {copied && ' (copied)'}, any future expiry date, CVV 123 and any US address, then <b className="text-pp-ink">Pay now as guest</b>. This is PayPal&apos;s test system: no real money moves.
    </p>
  );
}
