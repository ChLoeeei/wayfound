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
      question: '你勾了好几个 Vibe，最想突出哪一个？我会给它更多权重。',
      options: input.vibes,
    });
  }

  // 2. Family group + ≥ 3 people — kids on board?
  if (input.groupType === 'family' && input.people >= 3 && !input.specialNeeds.includes('baby')) {
    out.push({
      id: 'kidsOnBoard',
      question: '同行有小孩吗？方便我调整行程强度。',
      options: ['有小孩', '都是大人'],
    });
  }

  // 3. Budget range very wide — pick a side
  if (input.budget.min > 0 && input.budget.max > input.budget.min * 5) {
    out.push({
      id: 'budgetLean',
      question: `预算 ¥${input.budget.min} – ¥${input.budget.max} 跨度比较大，更倾向经济还是体验？`,
      options: ['偏经济', '中庸', '偏体验'],
    });
  }

  // 4. Long trip — multi-city?
  const days = diffDays(input.startDate, input.endDate);
  if (days >= 8) {
    out.push({
      id: 'multiCity',
      question: `${days} 天比较长，要不要安排多城市？`,
      options: ['只在一个城市', '可以加一两个邻近城市'],
    });
  }

  // 5. Vague destination — multiple places hinted by separators
  if (/[,，/、]/.test(input.destination)) {
    out.push({
      id: 'destinationFocus',
      question: '目的地里出现了多个地点，主要想集中在哪一个？',
    });
  }

  // PRD: at most 2
  return out.slice(0, 2);
}
