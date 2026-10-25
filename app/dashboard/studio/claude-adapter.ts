// AG Studio LLM adapter for Claude (browser half). AG Studio's Agent Framework is provider-neutral
// and ships an OpenAI adapter; this swaps Claude in. It posts each turn to this app's server route
// (app/api/ai/claude), which holds the Anthropic key, runs the Claude Messages API with streaming and
// translates the stream into AG-UI events (see lib/claude-bridge.ts). Tools are executed by Studio.

import type { AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from 'ag-studio';

interface ClaudeAdapterOptions {
  endpoint?: string;
}

function runTurn(endpoint: string, request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
  let resolve!: (r: AgLlmResponse) => void;
  let reject!: (e: Error) => void;
  const complete = new Promise<AgLlmResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void complete.catch(() => {}); // observed by Studio when it awaits; avoid unhandled rejections otherwise

  async function* events(): AsyncIterableIterator<AgAiEvent> {
    let final: AgLlmResponse | undefined;
    let failure: Error | undefined;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue;
          const data = JSON.parse(frame.slice(6));
          if (data.type === '__final') final = data.response as AgLlmResponse;
          else if (data.type === '__error') failure = new Error(data.message);
          else yield data as AgAiEvent;
        }
      }
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
    if (failure) reject(failure);
    else if (final) resolve(final);
    else reject(new Error('Claude stream ended without a final response.'));
  }

  const iterator = events();
  return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
}

export function claudeAdapter(options: ClaudeAdapterOptions = {}): AgLlmAdapter {
  const endpoint = options.endpoint ?? '/api/ai/claude';
  return { executeTurn: (request, opts) => runTurn(endpoint, request, opts?.signal) };
}
