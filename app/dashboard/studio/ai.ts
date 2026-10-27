// Dashboard assistant on Claude. Turns go through our server route, which holds the API key.

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiTool, type AgStudioApi } from 'ag-studio';
import { dealFacts } from '@/app/components/deal-facts';
import { claudeAdapter } from './claude-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: 'Where is my money?',
    prompt: 'How much is on hold in PayPal right now, how much was released this month, and which milestones are stuck?',
  },
  {
    label: 'Why was it held?',
    prompt: 'Find the milestones the AI did not pay out on its own and use explain_deal on each to say why: which criteria failed, and whether the second opinion refused the release.',
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

// Our own tool for Studio's agents: one deal, explained from its verdict, second opinion and PayPal state.
function explainDealTool(api: AgStudioApi): AgAiTool {
  return api.defineAiTool({
    name: 'explain_deal',
    description:
      'Explain where one escrow deal stands and why: the AI verdict on each criterion, whether the second model confirmed or refused the release, the PayPal state and the latest events. Use it when someone asks why a deal was paid, held, escalated or sent back. Takes the milestone id (the milestones table "id" field, like ms_1a2b3c4d5e6f).',
    params: (s) => s.object({ id: s.string({ description: 'The milestone id, like ms_1a2b3c4d5e6f' }) }),
    execute: async ({ id }, ctx) => {
      try {
        return ctx.success(await dealFacts(id));
      } catch (error) {
        return ctx.error((error as Error).message);
      }
    },
  });
}

// `models` come from CLAUDE_MODELS on the server. First one is the default; the picker shows for 2+.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = claudeAdapter({ endpoint: '/api/ai/claude' });

  return ({ api }) => {
    const explainDeal = explainDealTool(api);
    return createAiHarness(api, ({ builtIn }) => ({
      // AG's five agents on Claude; the lead and the data agent also get explain_deal.
      agents: Object.entries(builtIn).map(([id, agent]) =>
        directLlmRunner({
          ...agent,
          adapter,
          ...((id === 'lead' || id === 'data') && {
            tools: (ctx, params) => [...(agent.tools?.(ctx, params as never) ?? []), explainDeal],
          }),
        } as Parameters<typeof directLlmRunner>[0]),
      ),
      primary: 'lead',
      promptStarters: PROMPT_STARTERS,
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
    }));
  };
}
