// Claude settings shared by the reviewer and the dashboard assistant. Server-side only.

export const isClaudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Models the dashboard assistant may use, from CLAUDE_MODELS (comma-separated). The first is the default. */
export function aiModels(): string[] {
  const models = (process.env.CLAUDE_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return models.length > 0 ? models : ['claude-opus-5-5'];
}
