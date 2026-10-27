'use client';

import { useState } from 'react';

/** Drop a file to check it against the certificate: the SHA-256 is computed in the browser, nothing is uploaded. */
export function CheckFile({ hashes }: { hashes: { name: string; sha256: string }[] }) {
  const [result, setResult] = useState<{ file: string; match?: string } | null>(null);
  async function check(file: File) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    setResult({ file: file.name, match: hashes.find((h) => h.sha256 === hex)?.name });
  }
  return (
    <div className="mt-3 print:hidden">
      <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-pp-border bg-pp-canvas px-3 py-3 text-sm text-pp-muted hover:border-pp-blue">
        <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
        Have the file? Drop it here to check it against this certificate (it stays on your computer)
      </label>
      {result && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${result.match ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-pp-danger'}`}>
          {result.match ? `${result.file} is exactly the delivered ${result.match}.` : `${result.file} does not match any file delivered for this work.`}
        </p>
      )}
    </div>
  );
}
