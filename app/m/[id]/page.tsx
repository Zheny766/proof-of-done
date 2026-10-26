import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { getMilestone } from '@/lib/escrow/store';
import { paymentMode } from '@/lib/escrow/payments';
import { readMilestone } from '@/lib/escrow/service';
import { SiteHeader } from '@/app/components/site-header';
import { MilestoneView } from './milestone-view';

export async function generateMetadata(props: PageProps<'/m/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  return { title: getMilestone(id)?.title ?? 'Milestone' };
}

export default async function MilestonePage(props: PageProps<'/m/[id]'>) {
  await connection();
  const { id } = await props.params;
  const milestone = await readMilestone(id);
  if (!milestone) notFound();
  return (
    <>
      <SiteHeader />
      <MilestoneView initial={milestone} paypalClientId={paymentMode() === 'sandbox' ? (process.env.PAYPAL_CLIENT_ID ?? null) : null} />
    </>
  );
}
