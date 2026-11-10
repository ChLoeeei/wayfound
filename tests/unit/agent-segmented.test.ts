import { describe, it, expect } from 'vitest';
import { generateItinerary, daySegments, isSegmented, MAX_OUTPUT_TOKENS, type AgentStepRecord } from '../../server/agent';

/** Fake OpenAI client: returns the scripted contents in order and records every request. */
function fakeClient(contents: string[]) {
  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: any) => {
          requests.push(JSON.parse(JSON.stringify(body)));
          const content = contents.shift();
          if (content === undefined) throw new Error('fake client: no more scripted replies');
          return { choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      },
    },
  };
  return { client: client as any, requests };
}

const place = (name: string) => ({ id: name, name, type: 'attraction', coordinates: { lat: 43.8, lng: 87.6 }, rating: 4.5, estimatedCost: 0, duration: 60, imageUrl: 'https://invented.example/x.jpg', aiNote: '', externalUrl: '', searchQuery: name });
const day = (n: number) => ({ dayNumber: n, theme: `t${n}`, slots: [{ period: 'morning', places: [place(`P${n}`)] }] });
const outline = (days: number) => JSON.stringify({ title: 'T', summary: 'S', destination: '乌鲁木齐', startDate: '', endDate: '', dayThemes: Array.from({ length: days }, (_, i) => ({ dayNumber: i + 1, theme: `theme${i + 1}`, area: 'a' })) });
const req = (days: number) => ({ destination: '乌鲁木齐', days, people: 2, preferences: ['nature'] });

describe('segmented long-trip generation', () => {
  it('splits days into batches of 3', () => {
    expect(daySegments(10)).toEqual([[1, 3], [4, 6], [7, 9], [10, 10]]);
    expect(daySegments(6)).toEqual([[1, 3], [4, 6]]);
    expect(isSegmented({ days: 5 })).toBe(false);
    expect(isSegmented({ days: 6 })).toBe(true);
  });

  it('writes a 7-day trip as outline + 3 segments and merges them in order', async () => {
    const { client, requests } = fakeClient([
      outline(7),
      JSON.stringify({ days: [day(1), day(2), day(3)] }),
      // Off-by-one numbering from the model is renumbered to the segment's slots.
      JSON.stringify({ days: [day(5), day(6), day(7)] }),
      JSON.stringify({ days: [day(7)] }),
    ]);
    const stepTrace: AgentStepRecord[] = [];
    const it = (await generateItinerary(req(7), { client, stepTrace })) as any;
    expect(it.days.map((d: any) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(it.dayThemes).toBeUndefined();
    expect(it.title).toBe('T');
    expect(it.days[0].slots[0].places[0].imageUrl).toBe(''); // still sanitized
    expect(requests).toHaveLength(4);
    expect(requests.every(r => r.max_tokens === MAX_OUTPUT_TOKENS)).toBe(true);
    // Later segments are told which places are already used.
    expect(requests[2].messages.at(-1).content).toContain('P1, P2, P3');
    expect(stepTrace.at(-1)!.isFinal).toBe(true);
    expect(stepTrace.filter(s => s.segment)).toHaveLength(3);
    expect(stepTrace.filter(s => !s.segment)).toHaveLength(1);
  });

  it('asks for an outline when the final message is not one, and retries a short segment once', async () => {
    const { client, requests } = fakeClient([
      'I have gathered enough data.',
      outline(6),
      JSON.stringify({ days: [day(1)] }), // short
      JSON.stringify({ days: [day(1), day(2), day(3)] }),
      JSON.stringify({ days: [day(4), day(5), day(6)] }),
    ]);
    const it = (await generateItinerary(req(6), { client })) as any;
    expect(it.days).toHaveLength(6);
    expect(requests).toHaveLength(5);
  });

  it('keeps a complete itinerary if the model writes it all at once anyway', async () => {
    const full = { title: 'Full', days: Array.from({ length: 6 }, (_, i) => day(i + 1)) };
    const { client, requests } = fakeClient([JSON.stringify(full)]);
    const it = (await generateItinerary(req(6), { client })) as any;
    expect(it.title).toBe('Full');
    expect(requests).toHaveLength(1);
  });

  it('leaves short trips on the single-shot path', async () => {
    const { client, requests } = fakeClient([JSON.stringify({ title: 'Short', days: [day(1), day(2)] })]);
    const it = (await generateItinerary(req(2), { client })) as any;
    expect(it.days).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(requests[0].messages[1].content).not.toContain('written in parts');
  });
});
