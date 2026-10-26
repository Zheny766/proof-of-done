import Link from 'next/link';
import { InboxIcon } from './ui/icons';

// Shown in place of Studio while there are no milestones to report on.
export function EmptyData() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-pp-highlight text-pp-blue">
        <InboxIcon className="size-7" />
      </span>
      <h2 className="mt-4 text-xl font-semibold text-pp-navy">No milestones yet</h2>
      <p className="mt-2 max-w-md text-[15px] text-pp-muted">
        Create a milestone, or press <span className="font-semibold">Load demo history</span> on the milestones page to fill the
        dashboard with labelled sample data.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 items-center rounded-full bg-pp-blue px-5 font-semibold text-white hover:bg-pp-blue-dark"
      >
        Go to milestones
      </Link>
    </div>
  );
}
