'use client';

import { useState } from 'react';

/** Copies a command or config to the clipboard and says so for a moment. */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // No clipboard access (an insecure origin or a denied permission): the text stays selectable.
        }
      }}
      className={`rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white hover:bg-white/25 ${className}`}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}
