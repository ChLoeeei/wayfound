import OpenAI from 'openai';
import { runTool, toolDefinitions, ToolContext } from './tools';

/**
 * Master on/off switch for the agent's 5-layer error-recovery pipeline (see
 * CLAUDE.md's "Error-recovery layers" section) — for measuring what
 * recovery actually buys us (Priority 2). Defaults to OFF (i.e. recovery
 * ON), so current production behavior is unchanged unless explicitly
 * opted out of:
 *
 *   DISABLE_ERROR_RECOVERY=true npm run eval
 *
 * The 5 layers, all gated by this one flag:
 *   1. Per-tool-call try/catch      (this file, tool-call loop — also
 *      gates the adjacent malformed-tool-arguments fallback)
 *   2. Non-JSON final-answer retry  (this file, final-answer branch)
 *   3. Step-cap forced-final-answer (this file, after the loop)
 *   4. Prompt-level "never give up" guidance (buildSystemPrompt below)
 *   5. Server route try/catch (server.ts `/api/generate-itinerary`,
 *      gated by the same env var) — NOT exercised by the eval harness,
 *      which calls generateItinerary() directly and bypasses the HTTP
 *      layer entirely; only matters if you hit the running server.
 */
const RECOVERY_DISABLED = process.env.DISABLE_ERROR_RECOVERY === 'true';

/**
 * Output cap for every completion. DeepSeek's default (4k tokens) truncated
 * long itineraries mid-string ("Unterminated string in JSON") — a 10-day
 * trip failed in all 6 baseline runs. 8k is deepseek-chat's maximum.
 */
export const MAX_OUTPUT_TOKENS = 8192;

/**
 * Trips longer than this are written in segments: the tool loop ends with a
 * short outline, then each batch of SEGMENT_DAYS days is its own completion
 * (see writeSegmentedItinerary). Keeps every single output well under
 * MAX_OUTPUT_TOKENS regardless of trip length.
 */
export const SEGMENT_THRESHOLD_DAYS = 5;
export const SEGMENT_DAYS = 3;

export function isSegmented(req: Pick<PlanningRequest, 'days'>): boolean {
  return req.days > SEGMENT_THRESHOLD_DAYS;
}

/** Day ranges [from, to] (1-indexed, inclusive) for a segmented trip. */
export function daySegments(totalDays: number, size = SEGMENT_DAYS): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let from = 1; from <= totalDays; from += size) out.push([from, Math.min(totalDays, from + size - 1)]);
  return out;
}

/**
 * Schema we instruct DeepSeek to emit. Aligned with PRD §3.2 / §5.3:
 * Itinerary -> Day -> TimeSlot(period: morning|afternoon|evening) -> Place.
 */
const ITINERARY_SCHEMA_HINT = `Return JSON in EXACTLY this shape:
{
  "title": string,
  "summary": string,
  "destination": string,
  "startDate": string,                 // YYYY-MM-DD
  "endDate": string,                   // YYYY-MM-DD
  "days": [
    {
      "dayNumber": number,             // 1-indexed
      "theme": string,
      "slots": [
        {
          "period": "morning" | "afternoon" | "evening",
          "places": [
            {
              "id": string,            // unique random short id
              "name": string,
              "type": "attraction" | "restaurant" | "hotel" | "shopping" | "cafe" | "nightlife" | "leisure",
              "coordinates": { "lat": number, "lng": number },
              "rating": number,
              "estimatedCost": number, // RMB per person
              "duration": number,      // minutes
              "imageUrl": string,      // copy the POI's photoUrl from search_places/get_poi_details verbatim; "" if it had none. Never invent a URL.
              "aiNote": string,
              "externalUrl": string,
              "searchQuery": string
            }
          ]
        }
      ]
    }
  ]
}`;

const OUTLINE_SCHEMA_HINT = `{
  "title": string,
  "summary": string,
  "destination": string,
  "startDate": string,                 // YYYY-MM-DD
  "endDate": string,                   // YYYY-MM-DD
  "dayThemes": [ { "dayNumber": number, "theme": string, "area": string } ]   // one entry per day, area = neighbourhood/zone that day covers
}`;

export interface PlanningRequest {
  destination: string;
  days: number;
  people: number;
  preferences: string[]; // vibes
  groupType?: string;
  budget?: { min: number; max: number };
  specialNeeds?: string[];
  startDate?: string;
  endDate?: string;
  clarifications?: Record<string, string>;
  /** Optional rendered summary of the user's cross-session memory (see src/lib/memory.ts). */
  memoryContext?: string;
}

/**
 * Recovery layer 4: the "never give up" guidance is conditionally
 * included so DISABLE_ERROR_RECOVERY=true measures what the model does
 * without this steering, not just what the code does — the rest of the
 * prompt (workflow steps, constraints) is unconditional and changes
 * whenever those get edited; only the recovery-gated lines are meant to
 * stay stable across that toggle.
 */
function buildSystemPrompt(recoveryDisabled: boolean): string {
  const workflowSteps = [
    "Use `search_places` to discover real candidate POIs that match the user's vibes — it works for ANY destination, automatically routing to the right map provider (mainland China vs. international) behind the scenes. Pass the destination city via `region`, not appended to `keywords`. Use Chinese names for mainland-China destinations, local/English names elsewhere.",
    'Optionally call `get_destination_context` once per destination for a short real travel-guide extract — use it to ground `aiNote`/summary text in actual context, not to find POI coordinates (use `search_places` for that). Skip it if it returns nothing; that just means fall back to general knowledge for that destination.',
    ...(recoveryDisabled
      ? []
      : [
          "If a specific search_places call genuinely returns no results (obscure place, transient error), don't abandon tools for the whole itinerary — fall back to general knowledge for that one place (pick a well-known POI, supply plausible coordinates yourself) and keep going.",
        ]),
    'Use `calculate_distance` between adjacent stops (only when both POIs came from search_places) to keep the daily route compact.',
    'Use `get_poi_details` only when you need rating or address detail not returned by search.',
    'After tool calls, emit the FINAL itinerary JSON in your last message.',
  ];

  const constraints = [
    'Always prefer Chinese names for POIs inside mainland China.',
    'Each day must have AT LEAST one of each: morning, afternoon, evening slot when feasible.',
    'Keep places per day to 3-5 to avoid burnout.',
    "Respect the user's budget range when picking restaurants/hotels.",
    'Never include markdown fences. The final assistant message body must be ONLY the JSON object.',
    ...(recoveryDisabled
      ? []
      : ['If a tool returns an error or empty results, do NOT give up. Plan with general knowledge instead.']),
  ];

  return [
    'You are Wayfound, an elite travel planner.',
    'You always respond with valid JSON matching the requested schema.',
    '',
    'Workflow when planning:',
    ...workflowSteps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Constraints:',
    ...constraints.map(c => `- ${c}`),
  ].join('\n');
}

/** One tool invocation made during a `generateItinerary` run, for tracing/eval. */
export interface ToolCallRecord {
  step: number;
  name: string;
  args: Record<string, any>;
  ok: boolean;
  /** Compact, human-readable summary of the result — not the full payload. */
  resultSummary: string;
}

/**
 * One full loop iteration ("reasoning step -> tool call(s) -> result ->
 * next step"), for the persistent per-request trace/viewer. Deliberately a
 * SEPARATE side-channel from `trace` (ToolCallRecord[], flat, one entry per
 * tool call) rather than an extension of it — tests/eval/scoring.ts's
 * totalCalls/errorCalls math reads `trace` directly, and folding
 * reasoning-only steps into that same array would silently change those
 * numbers. `stepTrace` groups by step instead, and also captures the
 * model's own reasoning text (when present) alongside that step's tool
 * calls, which `trace` never did.
 */
export interface AgentStepRecord {
  step: number;
  timestamp: string;
  /** The assistant's own message content for this step — often empty; a step can be pure tool-calling with no accompanying text. */
  reasoning: string;
  toolCalls: Array<{ name: string; args: Record<string, any>; ok: boolean; resultSummary: string }>;
  /** True once this step produced the final itinerary JSON (no further tool calls). */
  isFinal: boolean;
  /** Set on long-trip writing completions (outline / a day batch), which are not agent reasoning steps. */
  segment?: string;
}

export interface RunAgentOptions {
  client: OpenAI;
  model?: string;
  maxSteps?: number;
  /**
   * When provided, every tool call made during this run is pushed here in
   * order. Purely a side-channel for tracing/eval — does not affect
   * planning behavior. See tests/eval/ for a consumer.
   */
  trace?: ToolCallRecord[];
  /**
   * When provided, every loop iteration is pushed here — see
   * AgentStepRecord. Independent of `trace`; a caller can pass either,
   * both, or neither. See server.ts for the production consumer
   * (persists this to a per-request file for the debug trace viewer).
   */
  stepTrace?: AgentStepRecord[];
  /** Sampling temperature for the main tool-use loop (default 0.6). The JSON-repair retries keep their own lower temperature. */
  temperature?: number;
  /**
   * When provided, token usage of every completion this run made is added
   * here (side-channel for eval cost reporting; does not affect planning).
   */
  usage?: AgentUsage;
}

export interface AgentUsage {
  promptTokens: number;
  /** Subset of promptTokens served from DeepSeek's context cache (billed lower). 0 if the API doesn't report it. */
  cachedPromptTokens?: number;
  completionTokens: number;
  completions: number;
}

export function addUsage(acc: AgentUsage | undefined, response: OpenAI.Chat.Completions.ChatCompletion) {
  if (!acc) return;
  acc.completions++;
  acc.promptTokens += response.usage?.prompt_tokens ?? 0;
  acc.cachedPromptTokens = (acc.cachedPromptTokens ?? 0) + ((response.usage as any)?.prompt_cache_hit_tokens ?? 0);
  acc.completionTokens += response.usage?.completion_tokens ?? 0;
}

function summariseToolResult(name: string, args: Record<string, any>, result: unknown): string {
  const r = result as any;
  if (r && typeof r === 'object' && 'error' in r) return `error: ${r.error}`;
  switch (name) {
    case 'search_places': {
      const names = Array.isArray(r?.results) ? r.results.map((p: any) => p?.name).filter(Boolean) : [];
      // Not truncated tightly — this summary is a side-channel for
      // tracing/eval only, never sent back to the model, so it's fine to
      // keep enough names here for a hallucination-rate check to cross-reference against.
      return `${r?.count ?? names.length} result(s): ${names.slice(0, 20).join(', ')}`;
    }
    case 'get_poi_details':
      return r?.name ? `found: ${r.name}` : 'not found';
    case 'calculate_distance':
      return `${r?.distanceMeters ?? '?'}m / ${r?.durationSeconds ?? '?'}s`;
    default:
      return JSON.stringify(r).slice(0, 200);
  }
}

export async function generateItinerary(
  req: PlanningRequest,
  opts: RunAgentOptions,
): Promise<unknown> {
  const { client, model = 'deepseek-chat', maxSteps = 8, temperature = 0.6 } = opts;

  const segmented = isSegmented(req);
  const userPrompt = buildUserPrompt(req);
  const ctx = new ToolContext(req.destination);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(RECOVERY_DISABLED) },
    { role: 'user', content: userPrompt },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
      temperature,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
    addUsage(opts.usage, response);

    const msg = response.choices[0]?.message;
    if (!msg) throw new Error('Empty response from DeepSeek');

    messages.push(msg);

    const stepRecord: AgentStepRecord = {
      step,
      timestamp: new Date().toISOString(),
      reasoning: (msg.content || '').trim(),
      toolCalls: [],
      isFinal: false,
    };

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // Final answer expected to be JSON. If the model emitted prose
      // (e.g. "no results found"), retry with an explicit JSON instruction.
      const text = (msg.content || '').trim();
      if (segmented) {
        opts.stepTrace?.push(stepRecord);
        return sanitizeImageUrls(await writeSegmentedItinerary(req, opts, messages, text, step + 1), ctx);
      }
      stepRecord.isFinal = true;
      opts.stepTrace?.push(stepRecord);
      if (RECOVERY_DISABLED) {
        // Recovery layer 2 off: let a parse failure propagate as-is.
        return sanitizeImageUrls(JSON.parse(stripJsonFences(text || '{}')), ctx);
      }
      try {
        return sanitizeImageUrls(JSON.parse(stripJsonFences(text || '{}')), ctx);
      } catch {
        messages.push({
          role: 'user',
          content: `Your previous reply was not valid JSON. Even if some data was missing, you MUST emit a complete itinerary JSON now. Use general knowledge for any POI you could not search. ${ITINERARY_SCHEMA_HINT}`,
        });
        const retry = await client.chat.completions.create({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: MAX_OUTPUT_TOKENS,
        });
        addUsage(opts.usage, retry);
        const retryText = retry.choices[0]?.message?.content || '{}';
        return sanitizeImageUrls(JSON.parse(stripJsonFences(retryText)), ctx);
      }
    }

    for (const call of toolCalls) {
      const fn = call.function;
      let args: Record<string, any> = {};
      if (RECOVERY_DISABLED) {
        // Recovery layer 1 off: malformed tool-call JSON propagates as-is.
        args = fn.arguments ? JSON.parse(fn.arguments) : {};
      } else {
        try {
          args = fn.arguments ? JSON.parse(fn.arguments) : {};
        } catch {
          args = {};
        }
      }
      let result: unknown;
      if (RECOVERY_DISABLED) {
        // Recovery layer 1 off: a tool exception propagates and aborts the run.
        result = await runTool(ctx, fn.name, args);
      } else {
        try {
          result = await runTool(ctx, fn.name, args);
        } catch (err: any) {
          result = { error: err.message ?? String(err) };
        }
      }
      if (opts.trace || opts.stepTrace) {
        const isError = !!(result && typeof result === 'object' && 'error' in (result as any));
        const resultSummary = summariseToolResult(fn.name, args, result);
        opts.trace?.push({ step, name: fn.name, args, ok: !isError, resultSummary });
        stepRecord.toolCalls.push({ name: fn.name, args, ok: !isError, resultSummary });
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    opts.stepTrace?.push(stepRecord);
  }

  // Hit the step cap.
  if (RECOVERY_DISABLED) {
    // Recovery layer 3 off: no forced-final-answer fallback.
    throw new Error(
      `Hit maxSteps (${maxSteps}) without a final answer, and error recovery is disabled (DISABLE_ERROR_RECOVERY=true).`,
    );
  }
  if (segmented) {
    return sanitizeImageUrls(await writeSegmentedItinerary(req, opts, messages, '', maxSteps), ctx);
  }
  // Force a final answer.
  messages.push({
    role: 'user',
    content: `Stop calling tools and return the final itinerary JSON now. ${ITINERARY_SCHEMA_HINT}`,
  });
  const final = await client.chat.completions.create({
    model,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: MAX_OUTPUT_TOKENS,
  });
  addUsage(opts.usage, final);
  const text = final.choices[0]?.message?.content || '{}';
  opts.stepTrace?.push({
    step: maxSteps,
    timestamp: new Date().toISOString(),
    reasoning: '(forced final answer after hitting the step cap)',
    toolCalls: [],
    isFinal: true,
  });
  return sanitizeImageUrls(JSON.parse(stripJsonFences(text)), ctx);
}

function parseJsonObject(text: string): any | null {
  try {
    const v = JSON.parse(stripJsonFences(text || ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Long-trip writer. `messages` holds the whole research transcript (tool
 * calls + results); every segment request shares it as a common prefix, so
 * DeepSeek's context cache serves most of the prompt. Only the place names
 * already used are carried forward (not earlier segments' JSON), keeping
 * each request small. Each segment gets one repair retry unless recovery is
 * disabled; days are renumbered to their slot so a model off-by-one can't
 * produce duplicate or missing day numbers.
 */
async function writeSegmentedItinerary(
  req: PlanningRequest,
  opts: RunAgentOptions,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  outlineText: string,
  firstStep: number,
): Promise<Record<string, any>> {
  const { client, model = 'deepseek-chat' } = opts;
  let step = firstStep;
  const jsonCall = async (msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[], label: string) => {
    const r = await client.chat.completions.create({
      model,
      messages: msgs,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
    addUsage(opts.usage, r);
    opts.stepTrace?.push({ step: step++, timestamp: new Date().toISOString(), reasoning: label, toolCalls: [], isFinal: false, segment: label });
    return r.choices[0]?.message?.content || '';
  };

  // 1. Outline: use the model's own final message if it is one, else ask for it.
  let outline = parseJsonObject(outlineText);
  // The model sometimes writes the whole itinerary anyway; if it parsed and is complete, keep it.
  if (Array.isArray(outline?.days) && outline.days.length === req.days) {
    if (opts.stepTrace?.length) opts.stepTrace[opts.stepTrace.length - 1].isFinal = true;
    return outline;
  }
  if (!outline || !Array.isArray(outline.dayThemes)) {
    const ask = `Stop calling tools. Reply with ONLY the trip outline JSON (no places yet), one dayThemes entry per day for all ${req.days} days:\n${OUTLINE_SCHEMA_HINT}`;
    outline = parseJsonObject(await jsonCall([...messages, { role: 'user', content: ask }], '(segmented: trip outline)'));
    if (!outline) throw new Error('Segmented generation: model did not return a valid trip outline');
  }
  const themes: any[] = Array.isArray(outline.dayThemes) ? outline.dayThemes : [];
  const prefix: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...messages.filter(m => !(m.role === 'assistant' && !(m as any).tool_calls?.length)),
    { role: 'assistant', content: JSON.stringify(outline) },
  ];

  // 2. Days, one segment at a time.
  const days: any[] = [];
  const usedNames: string[] = [];
  for (const [from, to] of daySegments(req.days)) {
    const want = to - from + 1;
    const ask = [
      `Now write days ${from}–${to} of ${req.days} in full, following the outline themes for those days.`,
      usedNames.length ? `Earlier days already use these places — do not repeat them: ${usedNames.join(', ')}.` : '',
      `Reply with ONLY {"days": [ ...exactly ${want} day object(s), dayNumber ${from} to ${to}... ]}, each day in this shape:`,
      ITINERARY_SCHEMA_HINT,
    ].filter(Boolean).join('\n');
    const segMessages = [...prefix, { role: 'user' as const, content: ask }];
    let seg = parseJsonObject(await jsonCall(segMessages, `(segmented: days ${from}-${to})`));
    if (!RECOVERY_DISABLED && (!Array.isArray(seg?.days) || seg.days.length < want)) {
      const retryAsk = `${ask}\nYour previous reply was not valid or was missing days. Return all ${want} day(s) as complete JSON.`;
      seg = parseJsonObject(await jsonCall([...prefix, { role: 'user', content: retryAsk }], `(segmented: days ${from}-${to}, retry)`));
    }
    if (!Array.isArray(seg?.days) || seg.days.length === 0) {
      throw new Error(`Segmented generation: days ${from}-${to} were not returned as valid JSON`);
    }
    seg.days.slice(0, want).forEach((d: any, i: number) => {
      const dayNumber = from + i;
      const theme = themes.find(t => Number(t?.dayNumber) === dayNumber)?.theme;
      days.push({ ...d, dayNumber, theme: d?.theme || theme || '' });
      for (const slot of Array.isArray(d?.slots) ? d.slots : []) {
        for (const p of Array.isArray(slot?.places) ? slot.places : []) if (p?.name) usedNames.push(String(p.name));
      }
    });
  }
  if (opts.stepTrace?.length) opts.stepTrace[opts.stepTrace.length - 1].isFinal = true;

  const { dayThemes: _themes, ...meta } = outline;
  return { ...meta, days };
}

/**
 * Keeps a place's `imageUrl` only if it is a photoUrl a tool actually
 * returned this run; anything else is model-invented (confirmed live: a
 * Sensō-ji card got an unrelated Unsplash portrait) and is blanked so the
 * UI shows no image instead of a wrong one. Mutates and returns `itinerary`.
 */
export function sanitizeImageUrls<T>(itinerary: T, ctx: Pick<ToolContext, 'servedPhotoUrls'>): T {
  const days = (itinerary as any)?.days;
  if (!Array.isArray(days)) return itinerary;
  for (const day of days) {
    for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
      for (const place of Array.isArray(slot?.places) ? slot.places : []) {
        if (place && typeof place === 'object' && place.imageUrl && !ctx.servedPhotoUrls.has(place.imageUrl)) {
          place.imageUrl = '';
        }
      }
    }
  }
  return itinerary;
}

function buildUserPrompt(req: PlanningRequest): string {
  const lines: string[] = [
    `Plan a trip with the following parameters:`,
    `- Destination: ${req.destination}`,
    `- Duration: ${req.days} days`,
    `- Group: ${req.people} people${req.groupType ? ` (${req.groupType})` : ''}`,
    `- Vibes / Preferences: ${(req.preferences ?? []).join(', ') || 'none specified'}`,
  ];
  if (req.budget) {
    lines.push(`- Budget: ¥${req.budget.min}–${req.budget.max} per person per day`);
  }
  if (req.specialNeeds && req.specialNeeds.length > 0) {
    lines.push(`- Special needs: ${req.specialNeeds.join(', ')}`);
  }
  if (req.startDate && req.endDate) {
    lines.push(`- Travel window: ${req.startDate} to ${req.endDate}`);
  }
  if (req.clarifications && Object.keys(req.clarifications).length > 0) {
    lines.push(`- User clarifications: ${JSON.stringify(req.clarifications)}`);
  }
  if (req.memoryContext) {
    lines.push('', req.memoryContext);
  }
  if (isSegmented(req)) {
    lines.push(
      '',
      `This is a long trip (${req.days} days), so the itinerary is written in parts. Use the tools to gather real POI data for ALL ${req.days} days first.`,
      'When you are done with tools, do NOT write the full itinerary. Reply with ONLY this outline JSON (no places yet):',
      OUTLINE_SCHEMA_HINT,
      `You will then be asked for the days in batches of ${SEGMENT_DAYS}, each using this place schema:`,
      ITINERARY_SCHEMA_HINT,
    );
    return lines.join('\n');
  }
  lines.push('', 'Use the tools to gather real POI data, then produce the final itinerary.');
  lines.push(ITINERARY_SCHEMA_HINT);
  return lines.join('\n');
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }
  return trimmed;
}
