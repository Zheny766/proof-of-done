import Anthropic from '@anthropic-ai/sdk';
import type { AgLlmRequest } from 'ag-studio';
import { aiModels, claudeKeyConfigured } from '@/lib/ai';
import { ClaudeToAgTranslator, encodeConversation, encodeTools, steeringInstructions, toAgResponse } from '@/lib/claude-bridge';

// Server half of the Claude adapter for AG Studio (see app/dashboard/studio/claude-adapter.ts).
// Receives an AgLlmRequest, runs one Claude turn with streaming, and streams AG-UI events back as
// SSE, ending with the final AgLlmResponse. The API key never leaves the server.

const MAX_TOKENS = 32_000;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Thinking blocks must be replayed unchanged with the tool calls they produced. AG Studio keeps
// only summaries, so the original assistant content is remembered here per tool-call id.
const rawContent = new Map<string, Anthropic.Beta.BetaContentBlockParam[]>();
function remember(message: Anthropic.Beta.BetaMessage) {
  const toolIds = message.content.filter((b) => b.type === 'tool_use').map((b) => (b as Anthropic.Beta.BetaToolUseBlock).id);
  if (!toolIds.length) return;
  const blocks = message.content as unknown as Anthropic.Beta.BetaContentBlockParam[];
  for (const id of toolIds) rawContent.set(id, blocks);
  while (rawContent.size > 2000) rawContent.delete(rawContent.keys().next().value!);
}

const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

export async function POST(request: Request) {
  if (!claudeKeyConfigured()) {
    return Response.json({ error: { message: 'The AI assistant is not configured: set ANTHROPIC_API_KEY in .env.local.' } }, { status: 503 });
  }
  let body: AgLlmRequest;
  try {
    body = (await request.json()) as AgLlmRequest;
  } catch {
    return Response.json({ error: { message: 'Request body must be JSON.' } }, { status: 400 });
  }

  const models = aiModels();
  const model = body.model?.id && models.includes(body.model.id) ? body.model.id : models[0];
  const effort = body.model?.effort && EFFORTS.has(body.model.effort) ? body.model.effort : 'medium';
  const { system, messages } = encodeConversation(body.input ?? [], rawContent);
  const systemText = [body.instructions ?? '', ...system, ...steeringInstructions(body)].filter(Boolean).join('\n\n');
  const tools = body.toolChoice === 'none' ? [] : encodeTools(body.tools);
  const jsonOutput = body.responseFormat?.type === 'json';

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      try {
        const claude = client.beta.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            system: systemText || undefined,
            messages,
            ...(tools.length && { tools, tool_choice: { type: 'auto' as const } }),
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort: effort as 'medium' },
            // If a safety classifier declines, the API retries on a fallback model instead of stopping.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: request.signal },
        );
        const translator = new ClaudeToAgTranslator();
        for await (const event of claude) {
          for (const ag of translator.translate(event)) send(ag);
        }
        const final = await claude.finalMessage();
        remember(final);
        send({ type: '__final', response: toAgResponse(final, jsonOutput) });
      } catch (error) {
        const message =
          error instanceof Anthropic.APIError ? `Claude API ${error.status}: ${error.message}` : (error as Error).message ?? 'Claude request failed';
        send({ type: '__error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
  });
}
