'use client';

import { useEffect } from 'react';

// WebMCP: tools a page offers to AI agents running in the browser (a proposed web standard, in early
// preview in Chrome). Everything offered here only reads; an agent can look, never pay.
export type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  execute: (args: Record<string, unknown>) => Promise<string>;
};

type ModelContext = { registerTool: (tool: object, options?: { signal?: AbortSignal }) => unknown };

export function WebMcpTools({ tools }: { tools: WebMcpTool[] }) {
  useEffect(() => {
    // The spec puts it on document; earlier Chrome builds had it on navigator.
    const mc = ((document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext);
    if (!mc?.registerTool) return;
    const controller = new AbortController();
    for (const tool of tools) {
      try {
        void mc.registerTool({ ...tool, annotations: { readOnlyHint: true } }, { signal: controller.signal });
      } catch {
        // A tool with this name is already registered (another tab component); skip it.
      }
    }
    return () => controller.abort();
  }, [tools]);
  return null;
}
