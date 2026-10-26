// Claude settings shared by the reviewer and the dashboard assistant. Server-side only.

import Anthropic from '@anthropic-ai/sdk';

export const isClaudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Models the dashboard assistant may use, from CLAUDE_MODELS (comma-separated). The first is the default. */
export function aiModels(): string[] {
  const models = (process.env.CLAUDE_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return models.length > 0 ? models : ['claude-opus-5-5'];
}

/** The human-readable part of an Anthropic API error (the SDK message includes the raw JSON body). */
export function claudeErrorMessage(error: unknown): string | null {
  if (!(error instanceof Anthropic.APIError)) return null;
  const body = error.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? error.message;
}
