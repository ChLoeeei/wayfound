import OpenAI from 'openai';
import { runTool, toolDefinitions, ToolContext } from './tools';

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
}

const SYSTEM_PROMPT = `You are Wayfound, an elite travel planner.
You always respond with valid JSON matching the requested schema.

Workflow when planning:
1. For destinations in mainland China, use \`search_places\` to discover real candidate POIs that match the user's vibes. Use Chinese names.
2. For destinations OUTSIDE mainland China, the Amap tools may return empty results. In that case, fall back to general knowledge — pick well-known POIs and supply plausible coordinates yourself.
3. Use \`calculate_distance\` between adjacent stops (only when both POIs came from search_places) to keep the daily route compact.
4. Use \`get_poi_details\` only when you need rating or address detail not returned by search.
5. After tool calls, emit the FINAL itinerary JSON in your last message.

Constraints:
- Always prefer Chinese names for POIs inside mainland China.
- Each day must have AT LEAST one of each: morning, afternoon, evening slot when feasible.
- Keep places per day to 3-5 to avoid burnout.
- Respect the user's budget range when picking restaurants/hotels.
- Never include markdown fences. The final assistant message body must be ONLY the JSON object.
- If a tool returns an error or empty results, do NOT give up. Plan with general knowledge instead.`;

export interface RunAgentOptions {
  client: OpenAI;
  model?: string;
  maxSteps?: number;
}

export async function generateItinerary(
  req: PlanningRequest,
  opts: RunAgentOptions,
): Promise<unknown> {
  const { client, model = 'deepseek-chat', maxSteps = 8 } = opts;

  const userPrompt = buildUserPrompt(req);
  const ctx = new ToolContext();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
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

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // Final answer expected to be JSON. If the model emitted prose
      // (e.g. "no results found"), retry with an explicit JSON instruction.
      const text = (msg.content || '').trim();
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
      try {
        args = fn.arguments ? JSON.parse(fn.arguments) : {};
      } catch {
        args = {};
      }
      let result: unknown;
      try {
        result = await runTool(ctx, fn.name, args);
      } catch (err: any) {
        result = { error: err.message ?? String(err) };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Hit the step cap. Force a final answer.
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
