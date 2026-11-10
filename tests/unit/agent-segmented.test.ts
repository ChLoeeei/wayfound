import { describe, it, expect, vi, beforeEach } from 'vitest';

// Map search is mocked: `searchResults[keywords]` is what search_places returns.
const searchResults: Record<string, Array<{ id: string; name: string; location: string; type: string; address: string }>> = {};
const runToolCalls: Array<{ name: string; args: any }> = [];
vi.mock('../../server/tools', async importOriginal => {
  const real = await importOriginal<typeof import('../../server/tools')>();
  return {
    ...real,
    runTool: async (ctx: any, name: string, args: any) => {
      runToolCalls.push({ name, args });
      if (name !== 'search_places') return { error: 'not mocked' };
      const pois = searchResults[args.keywords] ?? [];
      ctx.rememberPois(pois);
      return { count: pois.length, results: pois };
    },
  };
});

import {
  generateItinerary,
  daySegments,
  isSegmented,
  extractSegmentDays,
  parseJsonLoose,
  SegmentedGenerationError,
  MAX_OUTPUT_TOKENS,
  type AgentStepRecord,
  type ToolCallRecord,
} from '../../server/agent';

type Reply = string | { tool_calls: Array<{ name: string; args: any }> };

/** Fake OpenAI client: returns the scripted replies in order and records every request. */
function fakeClient(replies: Reply[]) {
  const requests: any[] = [];
  let n = 0;
  const client = {
    chat: {
      completions: {
        create: async (body: any) => {
          requests.push(JSON.parse(JSON.stringify(body)));
          const r = replies.shift();
          if (r === undefined) throw new Error('fake client: no more scripted replies');
          const message =
            typeof r === 'string'
              ? { role: 'assistant', content: r }
              : { role: 'assistant', content: '', tool_calls: r.tool_calls.map(t => ({ id: `c${n++}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) };
          return { choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      },
    },
  };
  return { client: client as any, requests };
}

const poi = (name: string, lat = 43.8, lng = 87.6) => ({ id: `id-${name}`, name, location: `${lng},${lat}`, type: 'attraction', address: '' });
const place = (name: string) => ({ id: name, name, type: 'attraction', coordinates: { lat: 1, lng: 1 }, rating: 4.5, estimatedCost: 0, duration: 60, imageUrl: 'https://invented.example/x.jpg', aiNote: '', externalUrl: '', searchQuery: name });
const day = (n: number, name = `P${n}`) => ({ dayNumber: n, theme: `t${n}`, slots: [{ period: 'morning', places: [place(name)] }] });
const outline = (days: number) => JSON.stringify({ title: 'T', summary: 'S', destination: '乌鲁木齐', startDate: '', endDate: '', dayThemes: Array.from({ length: days }, (_, i) => ({ dayNumber: i + 1, theme: `theme${i + 1}`, area: 'a' })) });
const req = (days: number) => ({ destination: '乌鲁木齐', days, people: 2, preferences: ['nature'] });
const allPlaces = (it: any) => it.days.flatMap((d: any) => d.slots.flatMap((s: any) => s.places));

beforeEach(() => {
  for (const k of Object.keys(searchResults)) delete searchResults[k];
  runToolCalls.length = 0;
});

describe('segment parsing', () => {
  it('splits days into batches of 3; only trips over 5 days are segmented', () => {
    expect(daySegments(10)).toEqual([[1, 3], [4, 6], [7, 9], [10, 10]]);
    expect(daySegments(6)).toEqual([[1, 3], [4, 6]]);
    for (const d of [1, 2, 3, 4, 5]) expect(isSegmented({ days: d })).toBe(false);
    expect(isSegmented({ days: 6 })).toBe(true);
  });

  it('accepts the common shape variants', () => {
    const d4 = day(4);
    const d5 = day(5);
    expect(extractSegmentDays({ days: [d4, d5] })).toEqual([d4, d5]);
    expect(extractSegmentDays([d4, d5])).toEqual([d4, d5]);
    expect(extractSegmentDays({ itinerary: { days: [d4] } })).toEqual([d4]);
    expect(extractSegmentDays({ days: { '5': d5, '4': d4 } })).toEqual([d4, d5]);
    expect(extractSegmentDays({ day_5: d5, day4: d4 })).toEqual([d4, d5]);
    expect(extractSegmentDays(d4)).toEqual([d4]);
    expect(extractSegmentDays([{ days: [d4] }])).toEqual([d4]);
    expect(extractSegmentDays({ title: 'no days' })).toEqual([]);
    expect(extractSegmentDays(null)).toEqual([]);
  });

  it('parses JSON wrapped in prose or fences', () => {
    expect(parseJsonLoose('Here it is:\n{"days": []}\nDone')).toEqual({ days: [] });
    expect(parseJsonLoose('```json\n[1,2]\n```')).toEqual([1, 2]);
    expect(parseJsonLoose('not json')).toBeNull();
  });
});

describe('segmented long-trip generation', () => {
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
    expect(stepTrace.filter(s => !s.segment)).toHaveLength(1);
  });

  it('gives every segment the searched-place list, re-searches places not in it, and marks the ones still not found', async () => {
    searchResults['lake'] = [poi('天山天池', 43.88, 88.13), poi('红山公园', 43.81, 87.6)];
    searchResults['国际大巴扎'] = [poi('新疆国际大巴扎', 43.77, 87.63)];
    const { client, requests } = fakeClient([
      { tool_calls: [{ name: 'search_places', args: { keywords: 'lake', region: '乌鲁木齐' } }] },
      outline(6),
      JSON.stringify({ days: [day(1, '天山天池'), day(2, '国际大巴扎'), day(3, '红山公园')] }),
      JSON.stringify({ days: [day(4, 'Invented Place'), day(5, '天山天池'), day(6, '红山公园')] }),
    ]);
    const trace: ToolCallRecord[] = [];
    const it = (await generateItinerary(req(6), { client, trace })) as any;
    for (const r of requests.slice(2)) {
      expect(r.messages.at(-1).content).toContain('Places returned by search_places');
      expect(r.messages.at(-1).content).toContain('- 天山天池 | attraction | 43.88,88.13');
    }
    // Only the two places not in the searched set were re-searched, and both re-searches are in the trace.
    expect(runToolCalls.slice(1).map(c => c.args.keywords)).toEqual(['国际大巴扎', 'Invented Place']);
    expect(trace.filter(t => t.name === 'search_places')).toHaveLength(3);
    const byName = Object.fromEntries(allPlaces(it).map((p: any) => [p.name, p]));
    expect(byName['国际大巴扎'].coordinates).toEqual({ lat: 43.77, lng: 87.63 }); // grounded by re-search
    expect(byName['国际大巴扎'].unverified).toBeUndefined();
    expect(byName['Invented Place'].unverified).toBe(true);
    expect(byName['天山天池'].unverified).toBeUndefined();
  });

  it('asks for an outline when the final message is not one, and retries a short segment once', async () => {
    const { client, requests } = fakeClient([
      'I have gathered enough data.',
      outline(6),
      JSON.stringify({ days: [day(1)] }), // short
      JSON.stringify([day(1), day(2), day(3)]), // bare array is accepted
      JSON.stringify({ days: { '4': day(4), '5': day(5), '6': day(6) } }),
    ]);
    const it = (await generateItinerary(req(6), { client })) as any;
    expect(it.days).toHaveLength(6);
    expect(requests).toHaveLength(5);
  });

  it('throws with every raw reply attached when a segment is unusable even after the retry', async () => {
    const { client } = fakeClient([outline(6), 'garbage one', '{"oops": true}']);
    const err: any = await generateItinerary(req(6), { client }).catch(e => e);
    expect(err).toBeInstanceOf(SegmentedGenerationError);
    expect(err.message).toMatch(/days 1-3 were not returned as valid JSON/);
    expect(err.rawReplies.map((r: any) => r.content)).toEqual([outline(6), 'garbage one', '{"oops": true}']);
  });

  it('keeps a complete itinerary if the model writes it all at once anyway', async () => {
    const full = { title: 'Full', days: Array.from({ length: 6 }, (_, i) => day(i + 1)) };
    const { client, requests } = fakeClient([JSON.stringify(full)]);
    const it = (await generateItinerary(req(6), { client })) as any;
    expect(it.title).toBe('Full');
    expect(requests).toHaveLength(1);
  });
});

describe('short trips (<= 5 days) never touch the segmented path', () => {
  it.each([1, 3, 5])('%i-day trip: one completion, original prompt, no grounding list, no re-search, no marking', async days => {
    const { client, requests } = fakeClient([JSON.stringify({ title: 'Short', days: Array.from({ length: days }, (_, i) => day(i + 1)) })]);
    const stepTrace: AgentStepRecord[] = [];
    const it = (await generateItinerary(req(days), { client, stepTrace })) as any;
    expect(it.days).toHaveLength(days);
    expect(requests).toHaveLength(1);
    expect(requests[0].max_tokens).toBe(MAX_OUTPUT_TOKENS);
    const userPrompt = requests[0].messages[1].content as string;
    expect(userPrompt).toContain('Use the tools to gather real POI data, then produce the final itinerary.');
    expect(userPrompt).not.toContain('written in parts');
    expect(userPrompt).not.toContain('dayThemes');
    expect(runToolCalls).toHaveLength(0);
    expect(stepTrace.some(s => s.segment)).toBe(false);
    expect(allPlaces(it).some((p: any) => 'unverified' in p)).toBe(false);
  });
});
