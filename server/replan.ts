/**
 * Partial replanning (v2 feature C). Replans only the target slots of an
 * itinerary; everything else is passed to the model as fixed context and
 * must come back untouched (replanValidate.ts).
 *
 * Separate from generateItinerary on purpose: its prompt, loop and
 * post-processing are its own, so first-time generation (and every eval
 * baseline) is unchanged. The experience library is not injected here.
 *
 * Intents that need no model call are done deterministically: `remove`
 * drops the targets, `move` relocates a kept stop. `replace` and `add` run
 * a short tool loop (search_places & co.) and accept the result only if
 * validateReplan passes; one retry with the issues fed back, then give up
 * and leave the itinerary as it was.
 */
import { randomBytes } from 'node:crypto';
import type OpenAI from 'openai';
import type { Itinerary, Place, PlaceType, SlotPeriod } from '../src/types';
import { PERIOD_ORDER } from '../src/lib/itineraryOps';
import { ToolContext, runTool, toolDefinitions } from './tools/index';
import { parseLngLat } from './tools/provider';
import { type AgentStepRecord, type AgentUsage, type ToolCallRecord, MAX_OUTPUT_TOKENS, addUsage, parseJsonLoose } from './agent';
import { type EditPlan, type EditTarget, lockedTargets } from './editParse';
import { structureItinerary } from './structure';
import { type ValidationResult, validateReplan, violatesAvoid } from './replanValidate';

export interface ReplanRequest {
  itinerary: Itinerary;
  plan: EditPlan;
  language?: 'en' | 'zh';
  /** The user's avoid list from their memory; new stops must not violate it. */
  avoid?: string[];
  budgetCap?: number;
  people?: number;
  preferences?: string[];
  specialNeeds?: string[];
}

export interface ReplanOptions {
  client: OpenAI;
  model?: string;
  maxSteps?: number;
  temperature?: number;
  trace?: ToolCallRecord[];
  stepTrace?: AgentStepRecord[];
  usage?: AgentUsage;
  /** Eval hook: every model answer before validation, with its verdict. */
  onCandidate?: (info: { attempt: number; candidate: Itinerary; validation: ValidationResult }) => void;
}

export type ReplanResult =
  | {
      ok: true;
      itinerary: Itinerary;
      changedPlaceIds: string[];
      removedPlaceIds: string[];
      /** Which validation pass accepted the result (1 = first try, 2 = after one retry). */
      attempt: number;
      /** False for deterministic intents (remove / move): no model call was made. */
      modelCalled: boolean;
    }
  | { ok: false; reason: 'locked'; lockedSlotIds: string[] }
  | { ok: false; reason: 'invalid'; issues: string[]; attempt: number }
  | { ok: false; reason: 'error'; message: string };

const PLACE_TYPES: PlaceType[] = ['attraction', 'restaurant', 'hotel', 'shopping', 'cafe', 'nightlife', 'leisure'];
const newPlaceId = () => `p-${randomBytes(4).toString('hex')}`;

const REPLAN_SCHEMA = `Return JSON in EXACTLY this shape:
{
  "slots": [
    {
      "dayNumber": number,
      "period": "morning" | "afternoon" | "evening",
      "places": [
        {
          "id": string,                 // keep the id of a FIXED stop exactly; new stops: any new id
          "poiId": string,              // NEW stops: the "id" field of the search_places result you chose (required)
          "name": string,               // exactly as search_places returned it
          "type": "attraction" | "restaurant" | "hotel" | "shopping" | "cafe" | "nightlife" | "leisure",
          "coordinates": { "lat": number, "lng": number },   // from the search result
          "estimatedCost": number,      // per person, same currency as the itinerary
          "duration": number,           // minutes
          "aiNote": string              // one or two sentences: why this fits the request
        }
      ]
    }
  ]
}
One entry per target period, listing that period's COMPLETE list of stops in order (fixed stops copied as given, new stops from search results).`;

function buildSystemPrompt(): string {
  return [
    'You are Wayfound, replanning part of an existing itinerary.',
    'You always respond with valid JSON matching the requested schema.',
    '',
    'Rules:',
    '1. Change ONLY the target stops or periods. Every stop marked FIXED is copied back exactly as given (same id, name, coordinates, cost, duration, note); never add, drop or reorder fixed stops.',
    '2. Every NEW stop must be one of this conversation\'s `search_places` results: copy that result\'s id into "poiId" and use its exact name and coordinates. A new stop without a poiId from the results is rejected. If you cannot find a suitable real place, return the fixed stops only.',
    '3. Respect the avoid list absolutely, the budget cap, the special needs, and keep new stops close to their neighbours (walking or a short ride).',
    '4. Use Chinese names for places inside mainland China, local/English names elsewhere.',
    '5. After tool calls, emit the final JSON in your last message. No markdown fences.',
  ].join('\n');
}

function describeDay(it: Itinerary, dayNumber: number, targets: EditTarget[], keep: string[]): string {
  const day = it.days.find(d => d.dayNumber === dayNumber)!;
  const lines = [`Day ${dayNumber}${day.theme ? ` (${day.theme})` : ''}:`];
  for (const period of PERIOD_ORDER) {
    const slot = day.slots.find(s => s.period === period);
    const periodTarget = targets.some(t => t.dayNumber === dayNumber && t.period === period && !t.slotId);
    const places = slot?.places ?? [];
    lines.push(`  ${period}${periodTarget ? ' [TARGET PERIOD: replan these stops]' : ''}:`);
    if (places.length === 0) lines.push('    (empty)');
    for (const p of places) {
      const sid = p.slotId ?? p.id;
      const isTarget = periodTarget || targets.some(t => t.slotId === sid);
      const mark = isTarget && !keep.includes(sid) ? 'TARGET' : 'FIXED';
      lines.push(
        `    - ${mark} id=${p.id} "${p.name}" type=${p.type} lat=${p.coordinates?.lat} lng=${p.coordinates?.lng} cost=${p.estimatedCost} duration=${p.duration}${p.start ? ` time≈${p.start}-${p.end}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

function buildUserPrompt(req: ReplanRequest, targets: EditTarget[], feedback?: string[]): string {
  const it = req.itinerary;
  const days = [...new Set(targets.map(t => t.dayNumber))];
  const lines = [
    `Destination: ${it.destination}`,
    req.people ? `Group: ${req.people} people` : '',
    req.preferences?.length ? `Vibes: ${req.preferences.join(', ')}` : '',
    req.specialNeeds?.length ? `Special needs: ${req.specialNeeds.join(', ')}` : '',
    req.budgetCap != null ? `Budget cap: ¥${req.budgetCap} per person per day (day total must stay under it)` : '',
    req.avoid?.length ? `The user asked to AVOID: ${req.avoid.map(a => `"${a}"`).join(', ')}. Never pick a stop that is one of these.` : '',
    req.language === 'zh' ? 'Write aiNote in Simplified Chinese.' : 'Write aiNote in English.',
    '',
    `User request: "${req.plan.instruction}"`,
    `Intent: ${req.plan.intent}${req.plan.add.length ? `; looking for: ${req.plan.add.map(a => a.what + (a.type ? ` (${a.type})` : '')).join('; ')}` : ''}`,
    `Targets: ${targets.map(t => `day ${t.dayNumber} ${t.period}${t.slotId ? ` stop ${t.slotId}` : ' (whole period)'}`).join('; ')}`,
    '',
    'Context (change only TARGET stops / periods; FIXED stops are copied back unchanged):',
    ...days.map(d => describeDay(it, d, targets, req.plan.keep)),
    '',
  ];
  if (feedback?.length) {
    lines.push('Your previous answer was rejected for these reasons, fix them:', ...feedback.map(f => `- ${f}`), '');
  }
  lines.push('Use search_places to find real candidates, then produce the final JSON.', REPLAN_SCHEMA);
  return lines.filter(l => l !== '').join('\n');
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** `remove` and `move` need no model: apply them directly. */
function applyDeterministic(req: ReplanRequest, targets: EditTarget[]): Itinerary {
  const it = clone(req.itinerary);
  const { intent, keep } = req.plan;
  if (intent === 'remove') {
    for (const t of targets) {
      const slot = it.days.find(d => d.dayNumber === t.dayNumber)?.slots.find(s => s.period === t.period);
      if (!slot) continue;
      slot.places = t.slotId ? slot.places.filter(p => (p.slotId ?? p.id) !== t.slotId) : [];
    }
    return it;
  }
  // move: take the kept stops out of wherever they are and append them to the (single) target period.
  const dest = targets[0];
  const moving: Place[] = [];
  for (const d of it.days) for (const s of d.slots) {
    const stay = s.places.filter(p => !keep.includes(p.slotId ?? p.id));
    moving.push(...s.places.filter(p => keep.includes(p.slotId ?? p.id)));
    s.places = stay;
  }
  const day = it.days.find(d => d.dayNumber === dest.dayNumber)!;
  let slot = day.slots.find(s => s.period === dest.period);
  if (!slot) {
    slot = { period: dest.period, places: [] };
    day.slots.push(slot);
  }
  slot.places.push(...moving);
  return it;
}

/** Builds the candidate itinerary from the model's `slots` answer. */
function applyModelSlots(req: ReplanRequest, targets: EditTarget[], answer: unknown, ctx: ToolContext): Itinerary {
  const it = clone(req.itinerary);
  const slotsOut: any[] = Array.isArray((answer as any)?.slots) ? (answer as any).slots : [];
  const knownIds = new Set<string>();
  for (const d of req.itinerary.days) for (const s of d.slots) for (const p of s.places) knownIds.add(p.id);
  const normalise = (raw: any): Place | null => {
    const name = String(raw?.name ?? '').trim();
    if (!name) return null;
    // Grounding is by id: the model must hand back the search result's id.
    // A name that merely looks like a result is not enough (validateReplan rejects it).
    const poiId = String(raw?.poiId ?? '').trim();
    const poi = poiId ? ctx.getPoi(poiId) : undefined;
    const loc = poi ? parseLngLat(poi.location) : null;
    const lat = loc?.lat ?? Number(raw?.coordinates?.lat);
    const lng = loc?.lng ?? Number(raw?.coordinates?.lng);
    const type = PLACE_TYPES.includes(raw?.type) ? (raw.type as PlaceType) : 'attraction';
    return {
      id: newPlaceId(),
      name: poi?.name ?? name,
      type,
      coordinates: { lat: Number.isFinite(lat) ? lat : 0, lng: Number.isFinite(lng) ? lng : 0 },
      ...(poi?.rating != null ? { rating: poi.rating } : {}),
      estimatedCost: Math.max(0, Number(raw?.estimatedCost) || 0),
      duration: Math.max(15, Number(raw?.duration) || 90),
      ...(raw?.aiNote ? { aiNote: String(raw.aiNote).slice(0, 400) } : {}),
      ...(poi ? { poiId: poi.id } : { unverified: true }),
    };
  };

  for (const t of targets) {
    const day = it.days.find(d => d.dayNumber === t.dayNumber);
    if (!day) continue;
    let slot = day.slots.find(s => s.period === t.period);
    if (!slot) {
      slot = { period: t.period, places: [] };
      day.slots.push(slot);
    }
    const out = slotsOut.find(s => Number(s?.dayNumber) === t.dayNumber && s?.period === t.period);
    if (!out) continue;
    const returned: any[] = Array.isArray(out.places) ? out.places : [];
    const original = req.itinerary.days.find(d => d.dayNumber === t.dayNumber)!.slots.find(s => s.period === t.period)?.places ?? [];
    const newOnes = returned.filter(p => !knownIds.has(String(p?.id))).map(normalise).filter((p): p is Place => !!p);

    if (t.slotId) {
      // Stop-level: swap that one stop for the new ones, keep everything else as it was.
      const idx = original.findIndex(p => (p.slotId ?? p.id) === t.slotId);
      const next = [...original];
      if (idx >= 0) next.splice(idx, 1, ...newOnes);
      else next.push(...newOnes);
      slot.places = next;
    } else if (req.plan.intent === 'add') {
      slot.places = [...original, ...newOnes];
    } else {
      // Whole-period replace: the returned order, with fixed stops (the user's keep list) copied from the original.
      const next: Place[] = [];
      for (const raw of returned) {
        const orig = original.find(p => p.id === String(raw?.id));
        if (orig) next.push(clone(orig));
        else {
          const np = normalise(raw);
          if (np) next.push(np);
        }
      }
      // Kept stops that the model dropped are put back at their original index.
      for (const p of original.filter(p => req.plan.keep.includes(p.slotId ?? p.id))) {
        if (!next.some(x => x.id === p.id)) next.splice(Math.min(original.indexOf(p), next.length), 0, clone(p));
      }
      slot.places = next;
    }
  }
  return it;
}

export async function replanItinerary(req: ReplanRequest, opts: ReplanOptions): Promise<ReplanResult> {
  const { client, model = 'deepseek-chat', maxSteps = 6, temperature = 0.4 } = opts;
  const plan = req.plan;
  const targets = plan.targetSlots;
  if (plan.intent === 'unclear' || targets.length === 0) return { ok: false, reason: 'error', message: 'nothing to replan' };

  const locked = lockedTargets(req.itinerary, plan);
  if (locked.length > 0) return { ok: false, reason: 'locked', lockedSlotIds: locked };

  const avoid = req.avoid ?? [];
  const finish = (after: Itinerary, v: ValidationResult, attempt: number, modelCalled: boolean, pois: { id: string; name: string }[]): ReplanResult => {
    const structured = structureItinerary(after, pois);
    structured.version = (req.itinerary.version ?? 1) + 1;
    return { ok: true, itinerary: structured, changedPlaceIds: v.changedPlaceIds, removedPlaceIds: v.removedPlaceIds, attempt, modelCalled };
  };

  if (plan.intent === 'remove' || plan.intent === 'move') {
    if (plan.intent === 'move' && plan.keep.length === 0) return { ok: false, reason: 'error', message: 'move needs the stop to move' };
    const after = applyDeterministic(req, targets);
    // Moved stops already existed, so nothing new needs a POI id here.
    const v = validateReplan(req.itinerary, after, plan.intent === 'move' ? [...targets, ...sourceTargets(req.itinerary, plan.keep)] : targets, { poiIds: [], avoid: [], budgetCap: req.budgetCap });
    if (!v.ok) return { ok: false, reason: 'invalid', issues: v.issues, attempt: 1 };
    return finish(after, v, 1, false, []);
  }

  const ctx = new ToolContext(req.itinerary.destination);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(req, targets) },
  ];
  let attempt = 1;
  let step = 0;
  try {
    while (step < maxSteps) {
      const response = await client.chat.completions.create({ model, messages, tools: toolDefinitions, tool_choice: 'auto', temperature, max_tokens: MAX_OUTPUT_TOKENS });
      addUsage(opts.usage, response);
      const msg = response.choices[0]?.message;
      if (!msg) throw new Error('Empty response from DeepSeek');
      messages.push(msg);
      const record: AgentStepRecord = { step, timestamp: new Date().toISOString(), reasoning: (msg.content || '').trim(), toolCalls: [], isFinal: false, segment: 'replan' };
      const calls = msg.tool_calls ?? [];
      if (calls.length > 0) {
        for (const call of calls) {
          let args: Record<string, any> = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            args = {};
          }
          let result: unknown;
          try {
            result = await runTool(ctx, call.function.name, args);
          } catch (err: any) {
            result = { error: err?.message ?? String(err) };
          }
          const ok = !(result && typeof result === 'object' && 'error' in (result as any));
          const summary = summarise(call.function.name, result);
          opts.trace?.push({ step, name: call.function.name, args, ok, resultSummary: summary });
          record.toolCalls.push({ name: call.function.name, args, ok, resultSummary: summary });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        opts.stepTrace?.push(record);
        step++;
        continue;
      }
      record.isFinal = true;
      opts.stepTrace?.push(record);
      step++;
      const answer = parseJsonLoose(msg.content || '{}');
      const after = applyModelSlots(req, targets, answer, ctx);
      const poiIds = ctx.allPois().map(p => p.id);
      const v = validateReplan(req.itinerary, after, targets, { poiIds, avoid, budgetCap: req.budgetCap });
      opts.onCandidate?.({ attempt, candidate: after, validation: v });
      if (v.ok && v.changedPlaceIds.length === 0) {
        v.issues.push('no stop was changed');
      }
      if (v.ok && v.issues.length === 0) return finish(after, v, attempt, true, ctx.allPois());
      if (attempt >= 2 || step >= maxSteps) return { ok: false, reason: 'invalid', issues: v.issues, attempt };
      attempt++;
      messages.push({ role: 'user', content: buildUserPrompt(req, targets, v.issues) });
    }
    return { ok: false, reason: 'invalid', issues: ['the replanner ran out of steps'], attempt };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? String(err) };
  }
}

/** For a move, the stop's original slot counts as a target too (it loses the stop). */
function sourceTargets(it: Itinerary, keep: string[]): EditTarget[] {
  const out: EditTarget[] = [];
  for (const d of it.days) for (const s of d.slots) for (const p of s.places) {
    const sid = p.slotId ?? p.id;
    if (keep.includes(sid)) out.push({ dayNumber: d.dayNumber, period: s.period as SlotPeriod, slotId: sid });
  }
  return out;
}

function summarise(name: string, result: unknown): string {
  if (result && typeof result === 'object' && 'error' in (result as any)) return `error: ${(result as any).error}`;
  if (name === 'search_places' && Array.isArray((result as any)?.pois)) {
    const pois = (result as any).pois as Array<{ name: string }>;
    return `${pois.length} result(s): ${pois.map(p => p.name).join(', ')}`;
  }
  return JSON.stringify(result).slice(0, 200);
}

export { violatesAvoid };
