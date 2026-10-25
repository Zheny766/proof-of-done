// The AG Studio AI assistant, powered by Claude. The adapter posts each turn to this app's server
// route (app/api/ai/claude), which holds the Anthropic key, so nothing secret is sent from the browser.

import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { claudeAdapter } from './claude-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: 'Where is my money?',
    prompt: 'How much is on hold in PayPal right now, how much was released this month, and which milestones are stuck?',
  },
  {
    label: 'Weak AI verdicts',
    prompt: 'Add a widget listing the criterion verdicts with confidence below 80%, lowest first, with the milestone and evidence.',
  },
  {
    label: 'Freelancer scorecard',
    prompt: 'Build a page that ranks freelancers by released value, average hours to get paid and how often the AI asked them for changes.',
  },
];

// `models` are the Claude model ids allowed by CLAUDE_MODELS on the server; the first is the default,
// and the picker only shows for two or more.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = claudeAdapter({ endpoint: '/api/ai/claude' });

  return ({ api }) =>
    createAiHarness(api, {
      adapter,
      promptStarters: PROMPT_STARTERS,
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
    });
}
