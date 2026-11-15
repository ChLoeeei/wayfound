import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tools are mocked: search_places returns canned Kyoto POIs, nothing hits a provider.
const searches: any[] = [];
vi.mock('../../server/tools/index', () => {
  class ToolContext {
    provider = 'mapbox';
    private pois = new Map<string, any>();
    constructor(public destination: string) {}
    rememberPois(p: any[]) {
      for (const x of p) this.pois.set(x.id, x);
    }
    allPois() {
      return [...this.pois.values()];
    }
    getPoi(id: string) {
      return this.pois.get(id);
    }
  }
  return {
    ToolContext,
    toolDefinitions: [],
    runTool: async (ctx: any, name: string, args: any) => {
      searches.push({ name, args });
      if (name !== 'search_places') return { error: 'not mocked' };
      const pois = [
        { id: 'poi-nishiki', name: 'Nishiki Market', address: '', location: '135.7649,35.0050', type: 'market', rating: 4.5 },
        { id: 'poi-karyo', name: "Gion Karyo 'Kaiseki'", address: '', location: '135.7750,35.0030', type: 'restaurant' },
      ];
      ctx.rememberPois(pois);
      return { pois, count: pois.length };
    },
  };
});

import { replanItinerary } from '../../server/replan';
import type { EditPlan } from '../../server/editParse';
import type { Itinerary, Place } from '../../src/types';

const place = (id: string, name: string, lat: number, lng: number, extra: Partial<Place> = {}): Place => ({
  id,
  slotId: `slot-${id}`,
  name,
  type: 'attraction',
  coordinates: { lat, lng },
  estimatedCost: 100,
  duration: 60,
  ...extra,
});
const base: Itinerary = {
  title: 't',
  destination: 'Kyoto',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  version: 1,
  days: [
    {
      dayNumber: 1,
      slots: [
        { period: 'morning', places: [place('a', 'Kiyomizu-dera', 34.9949, 135.785), place('b', 'Sannenzaka', 34.9966, 135.7807)] },
        { period: 'afternoon', places: [place('c', 'Kyoto National Museum', 34.9898, 135.7729)] },
        { period: 'evening', places: [place('d', 'Pontocho dinner', 35.0053, 135.7709, { type: 'restaurant', estimatedCost: 300 })] },
      ],
    },
    { dayNumber: 2, slots: [{ period: 'morning', places: [place('e', 'Bamboo Grove', 35.0171, 135.6717)] }] },
  ],
};
const plan = (over: Partial<EditPlan>): EditPlan => ({ intent: 'replace', targetSlots: [], add: [], keep: [], instruction: 'x', ...over });

function clientReplying(...contents: Array<string | { tool: string; args: any }>) {
  const queue = [...contents];
  const create = vi.fn().mockImplementation(async () => {
    const next = queue.shift();
    if (!next) throw new Error('no more scripted replies');
    if (typeof next === 'string') return { choices: [{ message: { role: 'assistant', content: next } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return {
      choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  });
  return { client: { chat: { completions: { create } } } as any, create };
}

beforeEach(() => searches.splice(0));

describe('replanItinerary', () => {
  it('refuses when a target is locked, before any model call', async () => {
    const locked: Itinerary = JSON.parse(JSON.stringify(base));
    locked.days[0].slots[1].places[0].locked = true;
    const { client, create } = clientReplying();
    const r = await replanItinerary({ itinerary: locked, plan: plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon' }] }) }, { client });
    expect(r).toEqual({ ok: false, reason: 'locked', lockedSlotIds: ['slot-c'] });
    expect(create).not.toHaveBeenCalled();
  });

  it('removes and moves stops without calling the model', async () => {
    const { client, create } = clientReplying();
    const removed = await replanItinerary({ itinerary: base, plan: plan({ intent: 'remove', targetSlots: [{ dayNumber: 1, period: 'morning', slotId: 'slot-b' }] }) }, { client });
    expect(removed.ok && removed.modelCalled).toBe(false);
    if (!removed.ok) throw new Error(JSON.stringify(removed));
    expect(removed.itinerary.days[0].slots[0].places.map(p => p.id)).toEqual(['a']);
    expect(removed.removedPlaceIds).toEqual(['b']);
    expect(removed.itinerary.version).toBe(2);

    const moved = await replanItinerary({ itinerary: base, plan: plan({ intent: 'move', targetSlots: [{ dayNumber: 2, period: 'afternoon' }], keep: ['slot-c'] }) }, { client });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    expect(moved.itinerary.days[0].slots[1].places).toEqual([]);
    expect(moved.itinerary.days[1].slots.find(s => s.period === 'afternoon')?.places.map(p => p.id)).toEqual(['c']);
    expect(create).not.toHaveBeenCalled();
  });

  it('replaces one stop with a searched place, keeps the rest byte-identical, re-packs times', async () => {
    const { client } = clientReplying(
      { tool: 'search_places', args: { keywords: 'market', region: 'Kyoto' } },
      JSON.stringify({ slots: [{ dayNumber: 1, period: 'afternoon', places: [{ id: 'new', poiId: 'poi-nishiki', name: 'Nishiki Market', type: 'shopping', coordinates: { lat: 1, lng: 1 }, estimatedCost: 50, duration: 90, aiNote: 'Food street' }] }] }),
    );
    const trace: any[] = [];
    const r = await replanItinerary(
      { itinerary: base, plan: plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon', slotId: 'slot-c' }], add: [{ what: 'a food market' }] }), budgetCap: 1000, avoid: ['museum'] },
      { client, trace },
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const after = r.itinerary;
    const np = after.days[0].slots[1].places[0];
    expect(np.name).toBe('Nishiki Market');
    expect(np.coordinates).toEqual({ lat: 35.005, lng: 135.7649 }); // from the search result, not the model
    expect(np.poiId).toBe('poi-nishiki');
    expect(np.rating).toBe(4.5);
    expect(np.slotId).toMatch(/^slot-/);
    expect(np.start).toBeDefined();
    expect(r.changedPlaceIds).toEqual([np.id]);
    expect(r.removedPlaceIds).toEqual(['c']);
    expect(r.modelCalled).toBe(true);
    expect(r.attempt).toBe(1);
    const strip = (it: Itinerary) => it.days.map(d => d.slots.map(s => s.places.map(p => ({ id: p.id, name: p.name, cost: p.estimatedCost }))));
    const beforeStripped = strip(base);
    const afterStripped = strip(after);
    beforeStripped[0][1] = [];
    afterStripped[0][1] = [];
    expect(afterStripped).toEqual(beforeStripped);
    expect(trace[0].name).toBe('search_places');
    expect(searches[0].args.region).toBe('Kyoto');
  });

  it('rejects a result that violates the avoid list, retries once with the issues, then gives up', async () => {
    const bad = JSON.stringify({ slots: [{ dayNumber: 1, period: 'afternoon', places: [{ id: 'n', poiId: 'poi-nishiki', name: 'Nishiki Market', type: 'shopping', coordinates: { lat: 1, lng: 1 }, estimatedCost: 50, duration: 90 }] }] });
    const { client, create } = clientReplying({ tool: 'search_places', args: { keywords: 'market' } }, bad, bad);
    const r = await replanItinerary({ itinerary: base, plan: plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon' }] }), avoid: ['购物'] }, { client });
    expect(r.ok).toBe(false);
    if (!('reason' in r) || r.reason !== 'invalid') throw new Error(JSON.stringify(r));
    expect(r.attempt).toBe(2);
    expect(r.issues[0]).toContain('avoid preference');
    // The retry prompt carried the issues back to the model.
    const lastUser = create.mock.calls[2][0].messages.filter((m: any) => m.role === 'user').pop();
    expect(lastUser.content).toContain('rejected for these reasons');
  });

  it('rejects a stop that only matches a result by name, without its id', async () => {
    const nameOnly = JSON.stringify({ slots: [{ dayNumber: 1, period: 'afternoon', places: [{ id: 'n', name: 'Nishiki Market', type: 'shopping', coordinates: { lat: 35.005, lng: 135.7649 }, estimatedCost: 50, duration: 90 }] }] });
    const { client } = clientReplying({ tool: 'search_places', args: { keywords: 'market' } }, nameOnly, nameOnly);
    const r = await replanItinerary({ itinerary: base, plan: plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon' }] }) }, { client });
    expect(r.ok).toBe(false);
    if (!('reason' in r) || r.reason !== 'invalid') throw new Error(JSON.stringify(r));
    expect(r.issues.join(' ')).toContain('poiId missing or unknown');
  });

  it('rejects an invented place that no search returned', async () => {
    const { client } = clientReplying(
      JSON.stringify({ slots: [{ dayNumber: 1, period: 'afternoon', places: [{ id: 'n', name: 'Imaginary Palace', type: 'attraction', coordinates: { lat: 34.99, lng: 135.77 }, estimatedCost: 0, duration: 60 }] }] }),
      JSON.stringify({ slots: [{ dayNumber: 1, period: 'afternoon', places: [{ id: 'n', name: 'Imaginary Palace', type: 'attraction', coordinates: { lat: 34.99, lng: 135.77 }, estimatedCost: 0, duration: 60 }] }] }),
    );
    const r = await replanItinerary({ itinerary: base, plan: plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon' }] }) }, { client });
    expect(r.ok).toBe(false);
    if (!('reason' in r) || r.reason !== 'invalid') throw new Error(JSON.stringify(r));
    expect(r.issues.join(' ')).toContain('poiId missing or unknown');
  });
});
