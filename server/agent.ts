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
              "imageUrl": string,
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
  const { client, model = 'deepseek-chat', maxSteps = 8 } = opts;

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
      temperature: 0.6,
    });

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
      stepRecord.isFinal = true;
      opts.stepTrace?.push(stepRecord);
      if (RECOVERY_DISABLED) {
        // Recovery layer 2 off: let a parse failure propagate as-is.
        return JSON.parse(stripJsonFences(text || '{}'));
      }
      try {
        return JSON.parse(stripJsonFences(text || '{}'));
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
        });
        const retryText = retry.choices[0]?.message?.content || '{}';
        return JSON.parse(stripJsonFences(retryText));
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
  });
  const text = final.choices[0]?.message?.content || '{}';
  opts.stepTrace?.push({
    step: maxSteps,
    timestamp: new Date().toISOString(),
    reasoning: '(forced final answer after hitting the step cap)',
    toolCalls: [],
    isFinal: true,
  });
  return JSON.parse(stripJsonFences(text));
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
