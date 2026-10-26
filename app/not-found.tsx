import Link from 'next/link';
import { SiteHeader } from './components/site-header';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-sm font-semibold text-pp-blue">404</p>
        <h1 className="mt-2 text-2xl font-bold text-pp-navy">This milestone or page doesn&apos;t exist</h1>
        <p className="mt-2 max-w-md text-sm text-pp-muted">The link may be mistyped, or the milestone was removed when the demo data was reset.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-pp-blue px-5 text-sm font-semibold text-white hover:bg-pp-blue-dark">
          Go to milestones
        </Link>
      </main>
    </>
  );
}
