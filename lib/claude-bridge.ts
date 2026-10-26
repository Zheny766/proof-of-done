// AG Studio's LLM protocol (AgLlmRequest in, AG-UI events + AgLlmResponse out) <-> Claude Messages API.
// AG Studio only ships an OpenAI adapter. No I/O in here so it's easy to test; the route in
// app/api/ai/claude does the actual API call.

import type Anthropic from '@anthropic-ai/sdk';
import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiToolSchema,
  AgLlmRequest,
  AgLlmResponse,
} from 'ag-studio';

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;
type JsonSchema = Record<string, unknown>;

/**
 * AG Studio's Shape library marks optional union members with the sentinel `{ not: {} }`.
 * Claude accepts standard JSON Schema, but the sentinel adds nothing, so it is stripped from
 * `anyOf` branches, recursively.
 */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(schema as JsonSchema)) out[k] = sanitizeSchema(v);
  if (Array.isArray(out.anyOf)) {
    const isSentinel = (b: unknown) =>
      !!b && typeof b === 'object' && Object.keys(b).length === 1 && 'not' in (b as JsonSchema) && Object.keys((b as JsonSchema).not as JsonSchema).length === 0;
    const kept = (out.anyOf as unknown[]).filter((b) => !isSentinel(b));
    if (kept.length === 1 && typeof kept[0] === 'object') {
      const rest = { ...out };
      delete rest.anyOf;
      return { ...(kept[0] as JsonSchema), ...rest };
    }
    out.anyOf = kept;
  }
  return out;
}

export function encodeTools(tools: AgAiToolSchema[] = []): Anthropic.Beta.BetaTool[] {
  return tools
    .filter((t) => t.kind !== 'provided')
    .map((t) => {
      const schema = sanitizeSchema(t.parameters ?? { type: 'object', properties: {} }) as JsonSchema;
      return {
        name: t.name,
        description: t.description,
        input_schema: { ...schema, type: 'object' } as Anthropic.Beta.BetaTool.InputSchema,
      };
    });
}

function imageBlock(url: string): Block | null {
  const m = url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[2] } };
  if (/^https?:\/\//.test(url)) return { type: 'image', source: { type: 'url', url } };
  return null;
}

/**
 * Raw assistant content from earlier turns, keyed by tool-call id. Claude's thinking blocks carry a
 * signature and must be replayed unchanged with the tool calls they produced; AG Studio's history
 * only keeps a text summary of reasoning, so the server remembers the original content here.
 */
export type RawContentCache = { get(callId: string): Block[] | undefined };

export function encodeConversation(input: AgAiConversationItem[], cache?: RawContentCache): { system: string[]; messages: Msg[] } {
  const system: string[] = [];
  const messages: Msg[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = messages.at(-1);
    if (last && last.role === role && Array.isArray(last.content)) (last.content as Block[]).push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };

  // Assistant output items arrive one by one; group consecutive ones into a single assistant turn.
  let pendingAssistant: { blocks: Block[]; callIds: string[] } | null = null;
  // Tool calls whose original content is gone (e.g. the server restarted mid-conversation). Claude
  // rejects a tool turn without its thinking blocks, so those calls and results go in as plain text.
  const flattened = new Map<string, string>();
  const flushAssistant = () => {
    if (!pendingAssistant) return;
    const { blocks, callIds } = pendingAssistant;
    const cached = callIds.map((id) => cache?.get(id)).find(Boolean);
    if (cached) push('assistant', cached);
    else if (cache && callIds.length) {
      const calls = blocks.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use');
      for (const c of calls) flattened.set(c.id, c.name);
      const said = blocks.filter((b) => b.type === 'text');
      push('assistant', [...said, { type: 'text', text: `(Earlier tool calls: ${calls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join(', ')})` }]);
    } else push('assistant', blocks);
    pendingAssistant = null;
  };

  for (const item of input) {
    if (item.kind === 'output' && item.type === 'message') {
      pendingAssistant ??= { blocks: [], callIds: [] };
      for (const c of item.content) if (c.type === 'text' && c.text) pendingAssistant.blocks.push({ type: 'text', text: c.text });
      continue;
    }
    if (item.kind === 'output' && item.type === 'function_call') {
      pendingAssistant ??= { blocks: [], callIds: [] };
      let parsed: unknown = {};
      try {
        parsed = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        parsed = {};
      }
      pendingAssistant.blocks.push({ type: 'tool_use', id: item.callId, name: item.name, input: parsed });
      pendingAssistant.callIds.push(item.callId);
      continue;
    }
    if (item.kind === 'output' && item.type === 'reasoning') continue; // summaries only; see cache above
    flushAssistant();

    if (item.type === 'function_call_output') {
      const name = flattened.get(item.callId);
      push('user', [
        name
          ? { type: 'text', text: `Result of ${name}: ${item.output || '(empty)'}` }
          : { type: 'tool_result', tool_use_id: item.callId, content: item.output || '(empty)' },
      ]);
      continue;
    }
    if (item.kind === 'input' && item.type === 'message') {
      if (item.role === 'system') {
        for (const c of item.content) if (c.type === 'text') system.push(c.text);
        continue;
      }
      const blocks: Block[] = [];
      for (const c of item.content) {
        if (c.type === 'text' && c.text) blocks.push({ type: 'text', text: c.text });
        else if (c.type === 'image' && c.imageUrl) {
          const b = imageBlock(c.imageUrl);
          if (b) blocks.push(b);
        } else if (c.type === 'file' && c.fileData) {
          blocks.push({ type: 'text', text: `File ${c.filename ?? ''}:\n${c.fileData}` });
        }
      }
      push('user', blocks);
    }
  }
  flushAssistant();

  // The Messages API needs the conversation to start with a user turn.
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: 'Continue.' });
  return { system, messages };
}

/** Instructions that replace features Claude expresses differently (forced tool choice, JSON-only text). */
export function steeringInstructions(request: Pick<AgLlmRequest, 'toolChoice' | 'responseFormat'>): string[] {
  const out: string[] = [];
  const tc = request.toolChoice;
  if (tc === 'required') out.push('You must respond by calling one of the available tools.');
  else if (tc && typeof tc === 'object') out.push(`You must respond by calling the tool "${tc.name}".`);
  if (request.responseFormat?.type === 'json') {
    out.push(
      `Your final answer must be a single JSON value named "${request.responseFormat.name}" that matches this JSON Schema. ` +
        `Output only the raw JSON: no prose, no code fences.\n${JSON.stringify(sanitizeSchema(request.responseFormat.schema))}`,
    );
  }
  return out;
}

type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

/** Stateful translator for one turn's stream. */
export class ClaudeToAgTranslator {
  private turnId = '';
  private readonly blocks = new Map<number, { kind: 'text' | 'reasoning' | 'tool'; id: string }>();

  translate(event: StreamEvent): AgAiEvent[] {
    switch (event.type) {
      case 'message_start':
        this.turnId = event.message.id;
        return [];
      case 'content_block_start': {
        const b = event.content_block;
        const id = `${this.turnId}_${event.index}`;
        if (b.type === 'text') {
          this.blocks.set(event.index, { kind: 'text', id });
          return [{ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }];
        }
        if (b.type === 'thinking') {
          this.blocks.set(event.index, { kind: 'reasoning', id });
          return [{ type: 'REASONING_MESSAGE_START', messageId: id, role: 'reasoning' }];
        }
        if (b.type === 'tool_use') {
          this.blocks.set(event.index, { kind: 'tool', id: b.id });
          return [{ type: 'TOOL_CALL_START', toolCallId: b.id, toolCallName: b.name }];
        }
        return [];
      }
      case 'content_block_delta': {
        const open = this.blocks.get(event.index);
        if (!open) return [];
        const d = event.delta;
        if (d.type === 'text_delta') return [{ type: 'TEXT_MESSAGE_CONTENT', messageId: open.id, delta: d.text }];
        if (d.type === 'thinking_delta' && d.thinking) return [{ type: 'REASONING_MESSAGE_CONTENT', messageId: open.id, delta: d.thinking }];
        if (d.type === 'input_json_delta' && d.partial_json) return [{ type: 'TOOL_CALL_ARGS', toolCallId: open.id, delta: d.partial_json }];
        return [];
      }
      case 'content_block_stop': {
        const open = this.blocks.get(event.index);
        if (!open) return [];
        if (open.kind === 'text') return [{ type: 'TEXT_MESSAGE_END', messageId: open.id }];
        if (open.kind === 'reasoning') return [{ type: 'REASONING_MESSAGE_END', messageId: open.id }];
        return [{ type: 'TOOL_CALL_END', toolCallId: open.id }];
      }
      default:
        return [];
    }
  }
}

const stripFences = (text: string) => text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

/** Build AG Studio's final response from Claude's final message. Ids match the streamed events. */
export function toAgResponse(message: Anthropic.Beta.BetaMessage, jsonOutput = false): AgLlmResponse {
  const output: AgAiOutputItem[] = [];
  message.content.forEach((b, index) => {
    const id = `${message.id}_${index}`;
    if (b.type === 'text') {
      output.push({
        id,
        kind: 'output',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text: jsonOutput ? stripFences(b.text) : b.text, annotations: [] }],
      });
    } else if (b.type === 'thinking') {
      if (b.thinking) output.push({ id, kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: b.thinking }] });
    } else if (b.type === 'tool_use') {
      output.push({
        id: b.id,
        kind: 'output',
        type: 'function_call',
        callId: b.id,
        name: b.name,
        arguments: JSON.stringify(b.input ?? {}),
        status: 'completed',
      });
    }
  });
  const truncated = message.stop_reason === 'max_tokens';
  return {
    id: message.id,
    createdAt: Math.floor(Date.now() / 1000),
    model: message.model,
    status: message.stop_reason === 'refusal' ? 'failed' : truncated ? 'incomplete' : 'completed',
    error: message.stop_reason === 'refusal' ? { code: 'refusal', message: 'The model declined this request.' } : undefined,
    incompleteDetails: truncated ? { reason: 'max_output_tokens' } : undefined,
    output,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      cachedInputTokens: message.usage.cache_read_input_tokens ?? undefined,
    },
  };
}
