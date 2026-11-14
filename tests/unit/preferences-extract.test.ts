import { describe, expect, it, vi } from 'vitest';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt, extractPreferences, parseExtraction } from '../../server/preferences';

const texts = ['I hate early mornings and I do not eat seafood.', '我们喜欢慢慢逛，一天两三个地方就够了', 'Budget about 200 to 400 a day per person'];

describe('parseExtraction keeps only quoted statements', () => {
  it('accepts items whose quote is in the text and maps them to fields', () => {
    const raw = JSON.stringify({
      items: [
        { field: 'avoid', value: 'early mornings', quote: 'I hate early mornings' },
        { field: 'avoid', value: 'seafood', quote: 'I do not eat seafood' },
        { field: 'pace', value: 'relaxed', quote: '一天两三个地方就够了' },
        { field: 'budget', value: { min: 200, max: 400 }, quote: 'Budget about 200 to 400 a day per person' },
      ],
    });
    const r = parseExtraction(raw, texts);
    expect(r.dropped).toBe(0);
    expect(r.preferences).toEqual({ avoid: ['early mornings', 'seafood'], pace: 'relaxed', budget: { min: 200, max: 400 } });
    expect(r.items).toHaveLength(4);
  });

  it('drops anything the user did not say: missing, paraphrased or invented quotes', () => {
    const raw = JSON.stringify({
      items: [
        { field: 'interest', value: 'food', quote: 'loves local food' }, // never said
        { field: 'avoid', value: 'crowds', quote: 'I hate crowds' }, // invented
        { field: 'pace', value: 'relaxed' }, // no quote at all
        { field: 'interest', value: 'nature', quote: 'I hate early mornings' }, // quote exists but value/field is a guess; we still accept only if valid field+value
        { field: 'budget', value: { min: 100, max: 400 }, quote: 'Budget about 200 to 400 a day per person' }, // numbers not in quote
      ],
    });
    const r = parseExtraction(raw, texts);
    // Only the "nature" item has a real quote. The guard cannot judge meaning, so it is kept;
    // the prompt is what forbids this, and the eval measures how often it slips through.
    expect(r.items.map(i => i.field)).toEqual(['interest']);
    expect(r.dropped).toBe(4);
  });

  it('is whitespace- and case-insensitive when matching quotes, and tolerates fenced JSON', () => {
    const raw = '```json\n' + JSON.stringify({ items: [{ field: 'avoid', value: 'seafood', quote: 'i DO not   eat seafood.' }] }) + '\n```';
    const r = parseExtraction(raw, texts);
    expect(r.preferences.avoid).toEqual(['seafood']);
  });

  it('returns nothing on malformed output', () => {
    expect(parseExtraction('not json', texts)).toEqual({ preferences: {}, items: [], dropped: 0 });
    expect(parseExtraction('{"items": "nope"}', texts)).toEqual({ preferences: {}, items: [], dropped: 0 });
  });

  it('rejects unknown fields and values', () => {
    const raw = JSON.stringify({
      items: [
        { field: 'pace', value: 'frantic', quote: 'I hate early mornings' },
        { field: 'hotel', value: 'Ritz', quote: 'I hate early mornings' },
        { field: 'interest', value: 'skiing', quote: 'I hate early mornings' },
      ],
    });
    const r = parseExtraction(raw, texts);
    expect(r.items).toEqual([]);
    expect(r.dropped).toBe(3);
  });
});

describe('extractPreferences', () => {
  it('skips the model call when there is no text', async () => {
    const create = vi.fn();
    const client = { chat: { completions: { create } } } as any;
    expect(await extractPreferences(client, ['', '  '])).toEqual({ preferences: {}, items: [], dropped: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the texts with the no-inference prompt and parses the reply', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ items: [{ field: 'avoid', value: 'seafood', quote: 'I do not eat seafood' }] }) } }],
    });
    const client = { chat: { completions: { create } } } as any;
    const r = await extractPreferences(client, texts, 'zh');
    expect(r.preferences.avoid).toEqual(['seafood']);
    const call = create.mock.calls[0][0];
    expect(call.temperature).toBe(0);
    expect(call.response_format).toEqual({ type: 'json_object' });
    expect(call.messages[0].content).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(call.messages[1].content).toBe(buildExtractionUserPrompt(texts, 'zh'));
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/Never infer/);
  });
});
