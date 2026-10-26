/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures use partial SDK shapes */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeToAgTranslator, encodeConversation, encodeTools, sanitizeSchema, steeringInstructions, toAgResponse } from '../lib/claude-bridge.ts';

test('sanitizeSchema drops the optional-member sentinel', () => {
  const s = sanitizeSchema({ type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { not: {} }], description: 'x' } } }) as any;
  assert.deepEqual(s.properties.a, { type: 'string', description: 'x' });
});

test('encodeTools wraps AG schemas as Claude tools', () => {
  const [t] = encodeTools([{ name: 'add_widget', description: 'Add a widget', parameters: { type: 'object', properties: { id: { type: 'string' } } } as any }]);
  assert.equal(t.name, 'add_widget');
  assert.equal((t.input_schema as any).type, 'object');
});

test('encodeConversation groups tool calls and results into alternating turns', () => {
  const { system, messages } = encodeConversation([
    { id: '1', kind: 'input', type: 'message', role: 'system', status: 'completed', content: [{ type: 'text', text: 'be brief' }] },
    { id: '2', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'show revenue' }] },
    { id: '3', kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: 'Looking', annotations: [] }] },
    { id: '4', kind: 'output', type: 'function_call', callId: 'toolu_1', name: 'view_schema', arguments: '{}', status: 'completed' },
    { id: '5', kind: 'output', type: 'function_call', callId: 'toolu_2', name: 'execute_query', arguments: '{"q":1}', status: 'completed' },
    { type: 'function_call_output', callId: 'toolu_1', output: 'schema', status: 'completed' },
    { type: 'function_call_output', callId: 'toolu_2', output: 'rows', status: 'completed' },
  ] as any);
  assert.deepEqual(system, ['be brief']);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  const assistant = messages[1].content as any[];
  assert.deepEqual(assistant.map((b) => b.type), ['text', 'tool_use', 'tool_use']);
  assert.deepEqual(assistant[2].input, { q: 1 });
  assert.deepEqual((messages[2].content as any[]).map((b) => b.tool_use_id), ['toolu_1', 'toolu_2']);
});

test('encodeConversation replays cached raw content (thinking blocks) for a tool turn', () => {
  const raw = [{ type: 'thinking', thinking: 'plan', signature: 'sig' }, { type: 'tool_use', id: 'toolu_9', name: 'x', input: {} }];
  const { messages } = encodeConversation([
    { id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'hi' }] },
    { id: '2', kind: 'output', type: 'function_call', callId: 'toolu_9', name: 'x', arguments: '{}', status: 'completed' },
    { type: 'function_call_output', callId: 'toolu_9', output: 'ok', status: 'completed' },
  ] as any, { get: (id) => (id === 'toolu_9' ? (raw as any) : undefined) });
  assert.equal((messages[1].content as any[])[0].type, 'thinking');
});

test('steering replaces forced tool choice and JSON mode with instructions', () => {
  const s = steeringInstructions({ toolChoice: { name: 'add_widget' }, responseFormat: { type: 'json', name: 'plan', schema: { type: 'object' } } as any });
  assert.match(s[0], /add_widget/);
  assert.match(s[1], /raw JSON/);
});

test('stream translation and final response share ids', () => {
  const t = new ClaudeToAgTranslator();
  const events = [
    { type: 'message_start', message: { id: 'msg_1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_a', name: 'add_widget', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '1}' } },
    { type: 'content_block_stop', index: 2 },
  ].flatMap((e) => t.translate(e as any));
  assert.deepEqual(events.map((e) => e.type), [
    'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END',
    'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
    'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_ARGS', 'TOOL_CALL_END',
  ]);
  const final = toAgResponse({
    id: 'msg_1', model: 'claude-opus-5-5', stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'hmm', signature: 's' },
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 'toolu_a', name: 'add_widget', input: { a: 1 } },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  } as any);
  assert.equal(final.status, 'completed');
  assert.equal((events[3] as any).messageId, final.output[1].id);
  assert.equal(final.output[2].type, 'function_call');
  assert.equal((final.output[2] as any).arguments, '{"a":1}');
});

test('JSON mode strips code fences from the final text', () => {
  const final = toAgResponse({ id: 'm', model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }], usage: { input_tokens: 1, output_tokens: 1 } } as any, true);
  assert.equal((final.output[0] as any).content[0].text, '{"ok":true}');
});

test('a tool turn missing from the cache (server restarted) is sent as plain text', () => {
  const emptyCache = { get: () => undefined };
  const { messages } = encodeConversation(
    [
      { id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'hi' }] },
      { id: '2', kind: 'output', type: 'function_call', callId: 'toolu_lost', name: 'view_schema', arguments: '{"t":1}', status: 'completed' },
      { type: 'function_call_output', callId: 'toolu_lost', output: 'schema', status: 'completed' },
      { id: '3', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'and now?' }] },
    ] as any,
    emptyCache,
  );
  const all = messages.flatMap((m) => m.content as any[]);
  assert.ok(!all.some((b) => b.type === 'tool_use' || b.type === 'tool_result'), 'no orphaned tool blocks');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match((messages[1].content as any[])[0].text, /view_schema\(\{"t":1\}\)/);
  assert.match((messages[2].content as any[])[0].text, /Result of view_schema: schema/);
});
