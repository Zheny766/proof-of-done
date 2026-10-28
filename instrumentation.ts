// Render's free plan puts the server to sleep after 15 minutes without a request, and the next
// visitor (a judge, say) waits up to a minute or gets a 503 while it wakes. On Render the server asks
// for one of its own pages every 10 minutes, through the public address so it counts as traffic.
// POD_KEEP_WARM=0 turns it off; it never runs outside Render.
export function register() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !url || process.env.POD_KEEP_WARM === '0') return;
  const timer = setInterval(() => {
    fetch(`${url.replace(/\/$/, '')}/llms.txt`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) }).catch(() => {});
  }, 10 * 60_000);
  timer.unref?.();
}
