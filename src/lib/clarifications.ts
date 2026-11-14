import { ClarificationQuestion, PlanningInput } from '../types';

function diffDays(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Build clarification questions from the planning input.
 * PRD §3.1 — at most 2 questions, each addresses an ambiguous field.
 *
 * Questions carry no text: the server runs this for /api/clarify-input, and
 * the client renders `clarify.<id>.question` / `clarify.<id>.options.<key>`
 * from its locale files (`clarificationText` in src/lib/clarifyText.ts),
 * so a language switch applies to pending questions too.
 */
export function buildClarifications(input: PlanningInput): ClarificationQuestion[] {
  const out: ClarificationQuestion[] = [];

  // 1. Too many vibes — prioritize one (options are vibe keys, rendered via form.vibes.*)
  if (input.vibes.length >= 4) {
    out.push({ id: 'primaryVibe', options: input.vibes });
  }

  // 2. Family group + ≥ 3 people — kids on board?
  if (input.groupType === 'family' && input.people >= 3 && !input.specialNeeds.includes('baby')) {
    out.push({ id: 'kidsOnBoard', options: ['kids', 'adults'] });
  }

  // 3. Budget range very wide — pick a side
  if (input.budget.min > 0 && input.budget.max > input.budget.min * 5) {
    out.push({
      id: 'budgetLean',
      params: { min: input.budget.min, max: input.budget.max },
      options: ['budget', 'balanced', 'splurge'],
    });
  }

  // 4. Long trip — multi-city?
  const days = diffDays(input.startDate, input.endDate);
  if (days >= 8) {
    out.push({ id: 'multiCity', params: { days }, options: ['one', 'multi'] });
  }

  // 5. Vague destination — multiple places hinted by separators
  if (/[,，/、]/.test(input.destination)) {
    out.push({ id: 'destinationFocus' });
  }

  // PRD: at most 2
  return out.slice(0, 2);
}
