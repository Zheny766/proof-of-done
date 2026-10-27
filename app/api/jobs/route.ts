import { publicJob } from '@/lib/escrow/access';
import { handle } from '@/lib/escrow/http';
import { openJobs } from '@/lib/escrow/service';

// The open job board: funded jobs anyone (or any agent) can take.
export const GET = handle(async () => Response.json({ jobs: openJobs().map(publicJob) }));
