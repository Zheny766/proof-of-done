// A page opened before a redeploy still asks for the old build's script files, which the new
// server doesn't have: the next click fails with a chunk load error. Reloading once fetches the
// new version, so a judge who left a tab open never sees an error page for it.

const KEY = 'pod-stale-reload';

export function isStaleBuild(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk [\w-]+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message)
  );
}

/** Reloads the page for a stale-build error, at most once every 30 seconds; true when it did. */
export function reloadIfStale(error: Error): boolean {
  if (!isStaleBuild(error)) return false;
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No session storage: without the guard a reload could repeat, so show the error page instead.
    return false;
  }
  window.location.reload();
  return true;
}
