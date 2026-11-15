import { describe, expect, it, vi } from 'vitest';
import { EDIT_PARSE_SYSTEM_PROMPT, itineraryOutline, lockedTargets, parseEdit, parseEditPlan } from '../../server/editParse';
import type { Itinerary } from '../../src/types';

const place = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  slotId: `slot-${id}`,
  name,
  type: 'attraction' as const,
  coordinates: { lat: 35, lng: 135 },
  estimatedCost: 0,
  duration: 60,
  start: '09:00',
  end: '10:00',
  ...extra,
});

const itinerary: Itinerary = {
  title: 't',
  destination: 'Kyoto',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  days: [
    {
      dayNumber: 1,
      theme: 'Higashiyama',
      slots: [
        { period: 'morning', places: [place('a', 'Kiyomizu-dera', { locked: true }), place('b', 'Sannenzaka')] },
        { period: 'afternoon', places: [place('c', 'Kyoto National Museum')] },
        { period: 'evening', places: [] },
      ],
    },
    { dayNumber: 2, slots: [{ period: 'morning', places: [place('d', 'Bamboo Grove')] }] },
  ],
};

describe('itineraryOutline', () => {
  it('lists every stop with its slot id, type, time and lock', () => {
    const o = itineraryOutline(itinerary);
    expect(o).toContain('Day 1 (Higashiyama):');
    expect(o).toContain('morning: [slot-a] Kiyomizu-dera (attraction, 09:00-10:00, LOCKED)');
    expect(o).toContain('evening: (empty)');
    expect(o).toContain('Day 2:');
  });
});

describe('parseEditPlan', () => {
  it('accepts stop-level and period-level targets and normalises the rest', () => {
    const plan = parseEditPlan(
      JSON.stringify({ intent: 'replace', targetSlots: [{ slotId: 'slot-c' }, { dayNumber: 2, period: 'afternoon' }, { dayNumber: 9, period: 'morning' }, { slotId: 'slot-zzz' }], add: [{ what: 'a ramen place', type: 'restaurant' }, { what: '', type: 'x' }], keep: ['slot-a', 'nope'] }),
      itinerary,
      'swap the museum for ramen',
    );
    expect(plan.intent).toBe('replace');
    expect(plan.targetSlots).toEqual([
      { dayNumber: 1, period: 'afternoon', slotId: 'slot-c' },
      { dayNumber: 2, period: 'afternoon' },
    ]);
    expect(plan.add).toEqual([{ what: 'a ramen place', type: 'restaurant' }]);
    expect(plan.keep).toEqual(['slot-a']);
    expect(plan.instruction).toBe('swap the museum for ramen');
  });

  it('turns unusable answers into a question or a bare unclear', () => {
    expect(parseEditPlan('nope', itinerary, 'x').intent).toBe('unclear');
    const q = parseEditPlan(JSON.stringify({ intent: 'unclear', question: 'Which day do you mean?' }), itinerary, 'x');
    expect(q).toMatchObject({ intent: 'unclear', question: 'Which day do you mean?', targetSlots: [] });
    // A real intent with only invented targets is also unclear.
    expect(parseEditPlan(JSON.stringify({ intent: 'remove', targetSlots: [{ slotId: 'slot-nope' }] }), itinerary, 'x').intent).toBe('unclear');
  });
});

describe('lockedTargets', () => {
  it('flags locked stops hit directly or through their period', () => {
    const base = { intent: 'replace' as const, add: [], keep: [], instruction: '' };
    expect(lockedTargets(itinerary, { ...base, targetSlots: [{ dayNumber: 1, period: 'morning', slotId: 'slot-a' }] })).toEqual(['slot-a']);
    expect(lockedTargets(itinerary, { ...base, targetSlots: [{ dayNumber: 1, period: 'morning' }] })).toEqual(['slot-a']);
    expect(lockedTargets(itinerary, { ...base, targetSlots: [{ dayNumber: 1, period: 'morning', slotId: 'slot-b' }] })).toEqual([]);
    expect(lockedTargets(itinerary, { ...base, targetSlots: [{ dayNumber: 1, period: 'afternoon' }] })).toEqual([]);
  });
});

describe('parseEdit', () => {
  it('sends the outline and the message, and parses the reply', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ intent: 'remove', targetSlots: [{ slotId: 'slot-b' }] }) } }] });
    const client = { chat: { completions: { create } } } as any;
    const plan = await parseEdit(client, itinerary, '把三年坂删掉', 'zh', 1);
    expect(plan.intent).toBe('remove');
    expect(plan.targetSlots).toEqual([{ dayNumber: 1, period: 'morning', slotId: 'slot-b' }]);
    const call = create.mock.calls[0][0];
    expect(call.messages[0].content).toBe(EDIT_PARSE_SYSTEM_PROMPT);
    expect(call.messages[1].content).toContain('[slot-b] Sannenzaka');
    expect(call.messages[1].content).toContain('looking at day 1');
    expect(call.messages[1].content).toContain('(Chinese): 把三年坂删掉');
    expect(call.temperature).toBe(0);
  });
});
