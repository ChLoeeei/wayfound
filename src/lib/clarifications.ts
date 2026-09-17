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
 */
export function buildClarifications(input: PlanningInput): ClarificationQuestion[] {
  const out: ClarificationQuestion[] = [];

  // 1. Too many vibes — prioritize one
  if (input.vibes.length >= 4) {
    out.push({
      id: 'primaryVibe',
      question: "You picked several vibes — which one matters most? I'll weight it heavier.",
      options: input.vibes,
    });
  }

  // 2. Family group + ≥ 3 people — kids on board?
  if (input.groupType === 'family' && input.people >= 3 && !input.specialNeeds.includes('baby')) {
    out.push({
      id: 'kidsOnBoard',
      question: "Are kids coming along? That'll help me tune the pace.",
      options: ['Yes, kids too', 'Adults only'],
    });
  }

  // 3. Budget range very wide — pick a side
  if (input.budget.min > 0 && input.budget.max > input.budget.min * 5) {
    out.push({
      id: 'budgetLean',
      question: `Your budget of ¥${input.budget.min}–¥${input.budget.max} is a wide range — lean more budget-friendly or more splurge?`,
      options: ['More budget-friendly', 'Balanced', 'More splurge-y'],
    });
  }

  // 4. Long trip — multi-city?
  const days = diffDays(input.startDate, input.endDate);
  if (days >= 8) {
    out.push({
      id: 'multiCity',
      question: `${days} days is a good chunk of time — want to cover multiple cities?`,
      options: ['Stay in one city', 'Add a nearby city or two'],
    });
  }

  // 5. Vague destination — multiple places hinted by separators
  if (/[,，/、]/.test(input.destination)) {
    out.push({
      id: 'destinationFocus',
      question: 'Looks like you listed a few places — which one should I focus on?',
    });
  }

  // PRD: at most 2
  return out.slice(0, 2);
}
