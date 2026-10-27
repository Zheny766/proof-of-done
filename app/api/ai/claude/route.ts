import Anthropic from '@anthropic-ai/sdk';
import type { AgLlmRequest } from 'ag-studio';
import { aiModels, claudeErrorMessage, isClaudeConfigured, refusalFallback } from '@/lib/ai';
import { allowRequest, isCrossSite } from '@/lib/rate-limit';
import { ClaudeToAgTranslator, encodeConversation, encodeTools, steeringInstructions, toAgResponse } from '@/lib/claude-bridge';

// One assistant turn for AG Studio: AgLlmRequest in, Claude streamed back as AG-UI events over SSE.
// Browser side is app/dashboard/studio/claude-adapter.ts.

// Enough for a widget or a page; caps what one request to this unauthenticated route can cost.
const MAX_TOKENS = 16_000;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Claude needs its thinking blocks sent back unchanged along with the tool calls they led to, but
// AG Studio only keeps summaries. So we keep the raw content here, keyed by tool call id.
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
  if (isCrossSite(request)) return Response.json({ error: { message: 'Cross-site request refused.' } }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 5_000_000) {
    return Response.json({ error: { message: 'Conversation too large.' } }, { status: 413 });
  }
  if (!allowRequest(request, 'assistant', 30)) {
    return Response.json({ error: { message: 'Too many requests, try again in a minute.' } }, { status: 429 });
  }
  if (!isClaudeConfigured()) {
    return Response.json({ error: { message: 'The AI assistant is not configured: set ANTHROPIC_API_KEY in .env.local.' } }, { status: 503 });
  }
  let body: AgLlmRequest;
  try {
    body = (await request.json()) as AgLlmRequest;
  } catch {
    return Response.json({ error: { message: 'Request body must be JSON.' } }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !Array.isArray(body.input) || (body.tools !== undefined && !Array.isArray(body.tools))) {
    return Response.json({ error: { message: 'Expected an AG Studio LLM request with an `input` array.' } }, { status: 400 });
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
            ...refusalFallback(model),
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
        const message = claudeErrorMessage(error) ?? (error as Error).message ?? 'Claude request failed';
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
