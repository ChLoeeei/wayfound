import type { ClarificationQuestion } from '../types';
import type { Translate } from '../i18n';

/**
 * Renders a clarification question (ids + option keys from
 * src/lib/clarifications.ts) in the active UI language. The option's
 * rendered text is what gets stored in PlanningInput.clarifications and
 * sent to the agent, so the user's answer reaches the model in the same
 * language as the rest of the conversation.
 */
export function clarificationQuestionText(q: ClarificationQuestion, t: Translate): string {
  return t(`clarify.${q.id}.question`, q.params);
}

export function clarificationOptionText(q: ClarificationQuestion, option: string, t: Translate): string {
  if (q.id === 'primaryVibe') return t(`form.vibes.${option}`);
  return t(`clarify.${q.id}.options.${option}`);
}
