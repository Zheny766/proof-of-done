import { readiness } from '@/lib/escrow/service';

// Is this copy ready, and in which mode? For judges and for checking a deployment (npm run smoke
// reads it too). Says whether each part is on, never a key.
export const dynamic = 'force-dynamic';

const started = Date.now();

export function GET() {
  try {
    return Response.json({
      status: 'ok',
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      ...readiness(),
    });
  } catch (error) {
    // The data file can't be read: say so instead of looking healthy.
    return Response.json({ status: 'error', error: (error as Error).message.slice(0, 200) }, { status: 503 });
  }
}
