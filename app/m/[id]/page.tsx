import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { publicMilestone, roleFor } from '@/lib/escrow/access';
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
  const { key } = await props.searchParams;
  const milestone = await readMilestone(id);
  if (!milestone) notFound();
  const linkKey = typeof key === 'string' ? key : null;
  const role = roleFor(milestone, linkKey);
  return (
    <>
      <SiteHeader />
      <MilestoneView
        initial={publicMilestone(milestone)}
        link={role === 'viewer' ? null : { role, key: linkKey! }}
        // The client gets the freelancer's link to pass on.
        freelancerKey={role === 'client' ? milestone.access!.freelancerKey : null}
        paypalClientId={paymentMode() === 'sandbox' ? (process.env.PAYPAL_CLIENT_ID ?? null) : null}
      />
    </>
  );
}
