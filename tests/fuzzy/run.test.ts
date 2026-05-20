import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import OpenAI from 'openai';
import casesJson from './cases.json';
import { generateItinerary } from '../../server/agent';
import { judgeItinerary, PASS_THRESHOLD, RUBRIC_DIMENSIONS, type RubricResult } from './judge';

interface FuzzyCase {
  id: string;
  destination: string;
  days: number;
  people: number;
  preferences: string[];
  groupType: string;
  budget: { min: number; max: number };
  specialNeeds: string[];
}

const allCases: FuzzyCase[] = (casesJson as { cases: FuzzyCase[] }).cases;
const filterIds = (process.env.FUZZY_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);
const cases: FuzzyCase[] = filterIds.length
  ? allCases.filter(c => filterIds.includes(c.id))
  : allCases;
const hasKey = Boolean(process.env.DEEPSEEK_API_KEY);

const results: Array<{ id: string; result: RubricResult; durationMs: number }> = [];

const TIMEOUT_MS = 180_000;

describe.skipIf(!hasKey)('Fuzzy LLM-as-Judge', () => {
  let client: OpenAI;

  beforeAll(() => {
    client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  });

  for (const c of cases) {
    it(
      `${c.id} — ${c.destination} ${c.days}d ${c.people}p`,
      { timeout: TIMEOUT_MS },
      async () => {
        const start = Date.now();
        const itinerary = await generateItinerary(
          {
            destination: c.destination,
            days: c.days,
            people: c.people,
            preferences: c.preferences,
            groupType: c.groupType,
            budget: c.budget,
            specialNeeds: c.specialNeeds,
          },
          { client },
        );
        const result = await judgeItinerary({ userProfile: c, itinerary }, client);
        const durationMs = Date.now() - start;
        results.push({ id: c.id, result, durationMs });

        // Per-case assertion: weighted total must clear the threshold
        expect(result.weighted_total).toBeGreaterThanOrEqual(PASS_THRESHOLD);
      },
    );
  }

  it('aggregate pass rate ≥ 80%', () => {
    if (results.length === 0) return;
    const passed = results.filter(r => r.result.pass).length;
    const rate = passed / results.length;

    // Print a compact report
    console.log('\n=== Fuzzy report ===');
    for (const r of results) {
      const dims = RUBRIC_DIMENSIONS.map(d => `${d.slice(0, 4)}=${r.result.scores[d].score}`).join(' ');
      console.log(`  ${r.result.pass ? '✓' : '×'} ${r.id} total=${r.result.weighted_total} ${dims} [${r.durationMs}ms]`);
    }
    console.log(`  pass rate: ${(rate * 100).toFixed(1)}% (${passed}/${results.length})`);
    console.log('====================\n');

    expect(rate).toBeGreaterThanOrEqual(0.8);
  });
});
