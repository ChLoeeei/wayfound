import { describe, it, expect } from 'vitest';
import { buildUserPrompt, type PlanningRequest } from '../../server/agent';

const req: PlanningRequest = {
  destination: 'Kyoto',
  days: 3,
  people: 2,
  preferences: ['food', 'culture'],
  groupType: 'couple',
  budget: { min: 300, max: 1500 },
  startDate: '2026-05-20',
  endDate: '2026-05-22',
};

/**
 * The eval harness and the learning loop never set `language`, so their
 * prompts must stay byte-identical to the committed baselines. This test
 * pins that: an absent (or unknown) language adds nothing.
 */
describe('buildUserPrompt language line', () => {
  it('is byte-identical without a language', () => {
    const base = buildUserPrompt(req);
    expect(base).not.toMatch(/Language:/);
    expect(buildUserPrompt({ ...req, language: undefined })).toBe(base);
    expect(buildUserPrompt({ ...req, language: 'fr' as any })).toBe(base);
  });

  it('asks for English or Simplified Chinese prose when the UI language is set', () => {
    const en = buildUserPrompt({ ...req, language: 'en' });
    const zh = buildUserPrompt({ ...req, language: 'zh' });
    expect(en).toContain('- Language: ');
    expect(en).toContain('in English');
    expect(zh).toContain('Simplified Chinese');
    // Place names stay as the tools returned them, in both languages.
    expect(en).toContain('Keep place names as the search tools returned them');
    expect(zh).toContain('Keep place names as the search tools returned them');
  });

  it('adds exactly one line and leaves the rest of the prompt unchanged', () => {
    const base = buildUserPrompt(req).split('\n');
    const withLang = buildUserPrompt({ ...req, language: 'zh' }).split('\n');
    expect(withLang.length).toBe(base.length + 1);
    expect(withLang.filter(l => !l.startsWith('- Language: '))).toEqual(base);
  });
});
