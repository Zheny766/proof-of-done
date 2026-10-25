// Server-side configuration for the AG Studio AI assistant, powered by Claude. The Anthropic key is
// read only on the server: it is never passed to a client component and has no NEXT_PUBLIC_ prefix.

const DEFAULT_MODELS = ['claude-opus-5-5'];

/** Whether an Anthropic credential is configured (the SDK reads ANTHROPIC_API_KEY itself). */
export const claudeKeyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Claude models the assistant may use, from CLAUDE_MODELS (comma-separated). The first is the default. */
export function aiModels(): string[] {
  const models = (process.env.CLAUDE_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

/** The assistant is shown only when a key is configured. */
export const aiEnabled = () => claudeKeyConfigured();
