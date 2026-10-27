import type { Metadata } from 'next';
import { SiteHeader } from '@/app/components/site-header';
import { MyDeals } from './my-deals';

export const metadata: Metadata = { title: 'My deals' };

export default function MinePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-12">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">My deals</p>
        <h1 className="mt-3 font-display text-5xl leading-tight text-pp-navy">Everything you pay for or get paid for</h1>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-pp-muted">
          Deals you created, funded, took or delivered in this browser. There are no accounts: each deal is opened by its private link, and this browser keeps the links you used.
        </p>
        <MyDeals />
      </main>
    </>
  );
}
