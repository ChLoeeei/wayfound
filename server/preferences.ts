/**
 * Preference extraction (v2 feature A): turns the free text a user typed in
 * a session into structured memory fields, keeping only what the user said
 * outright.
 *
 * Two guards against inference:
 *  1. The prompt asks for a verbatim quote per item and forbids guessing
 *     from destination, group or general knowledge.
 *  2. `parseExtraction` drops any item whose quote is not found in the
 *     user's text (whitespace-insensitive, case-insensitive), and any budget
 *     whose numbers are not in that quote. The model cannot add a
 *     preference it cannot point to.
 *
 * Form fields and quick-pick answers never come here; they are recorded
 * deterministically by src/lib/memory.ts. So this runs only when the user
 * typed something, which is also when it costs a (small) model call.
 */
import type OpenAI from 'openai';

export type Pace = 'relaxed' | 'moderate' | 'packed';
const PACES = new Set<Pace>(['relaxed', 'moderate', 'packed']);
const VIBES = new Set(['nature', 'culture', 'food', 'shopping', 'leisure', 'adventure']);

export interface ExtractionItem {
  field: 'pace' | 'interest' | 'avoid' | 'budget' | 'note';
  value: string | { min: number; max: number };
  quote: string;
}

export interface ExtractedPreferences {
  pace?: Pace;
  interests?: string[];
  avoid?: string[];
  budget?: { min: number; max: number };
  notes?: string[];
}

export interface ExtractionResult {
  preferences: ExtractedPreferences;
  /** Items kept, with the quote that justifies each. */
  items: ExtractionItem[];
  /** Items the model proposed without a quote from the text. */
  dropped: number;
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract travel preferences that a user stated explicitly, so they can be remembered for the user's future trips.

You get the user's own words from a trip-planning session. Return JSON: {"items": [{"field": ..., "value": ..., "quote": ...}]}.

Fields:
- "pace": value "relaxed" | "moderate" | "packed". Only when the user described how fast or full they want days to be.
- "interest": value one of nature | culture | food | shopping | leisure | adventure. Only when the user said they like or want that kind of thing.
- "avoid": a short phrase in the user's words for something they do not want (a food, an activity, a kind of place, early starts, crowds, ...).
- "budget": value {"min": number, "max": number} per person per day, only when the user gave numbers.
- "note": any other preference the user stated that would matter on a future trip and fits none of the above.

Rules:
- "quote" is copied verbatim from the user's text: the exact words that state the preference. No paraphrase.
- Include an item only if the user stated it. Never infer from the destination, the group, the season or general knowledge. Never add anything the quote does not say.
- Preferences about this one trip only (dates, a specific city, "this time") are not remembered: skip them.
- If nothing qualifies, return {"items": []}.`;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Parses the model's reply and keeps only items whose quote appears in the user's text. */
export function parseExtraction(raw: string, texts: string[]): ExtractionResult {
  const haystack = squash(texts.join('\n'));
  let parsed: any;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { preferences: {}, items: [], dropped: 0 };
  }
  const proposed: any[] = Array.isArray(parsed?.items) ? parsed.items : [];
  const items: ExtractionItem[] = [];
  let dropped = 0;
  const prefs: ExtractedPreferences = {};

  for (const it of proposed) {
    const quote = typeof it?.quote === 'string' ? it.quote.trim() : '';
    const field = it?.field;
    if (!quote || !haystack.includes(squash(quote))) {
      dropped++;
      continue;
    }
    if (field === 'pace' && typeof it.value === 'string' && PACES.has(it.value)) {
      prefs.pace = it.value as Pace;
      items.push({ field, value: it.value, quote });
    } else if (field === 'interest' && typeof it.value === 'string' && VIBES.has(it.value)) {
      prefs.interests = [...new Set([...(prefs.interests ?? []), it.value])];
      items.push({ field, value: it.value, quote });
    } else if (field === 'avoid' && typeof it.value === 'string' && it.value.trim()) {
      const v = it.value.trim().slice(0, 80);
      prefs.avoid = [...new Set([...(prefs.avoid ?? []), v])];
      items.push({ field, value: v, quote });
    } else if (field === 'budget' && it.value && Number.isFinite(Number(it.value.min)) && Number.isFinite(Number(it.value.max))) {
      const min = Number(it.value.min);
      const max = Number(it.value.max);
      const digits = quote.replace(/[,，]/g, '');
      if (min >= 0 && max >= min && digits.includes(String(min)) && digits.includes(String(max))) {
        prefs.budget = { min, max };
        items.push({ field, value: { min, max }, quote });
      } else dropped++;
    } else if (field === 'note' && typeof it.value === 'string' && it.value.trim()) {
      const v = it.value.trim().slice(0, 140);
      prefs.notes = [...new Set([...(prefs.notes ?? []), v])];
      items.push({ field, value: v, quote });
    } else {
      dropped++;
    }
  }
  return { preferences: prefs, items, dropped };
}

function stripFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export function buildExtractionUserPrompt(texts: string[], language?: string): string {
  const lines = ["The user's own words, one statement per line:", ...texts.map(t => `- ${t.replace(/\s+/g, ' ').trim()}`)];
  if (language === 'zh') lines.push('', 'Quotes stay in the original language; "avoid" and "note" values may stay in Chinese.');
  return lines.join('\n');
}

/** One small model call; the parse guard does the rest. */
export async function extractPreferences(client: OpenAI, texts: string[], language?: string, model = 'deepseek-chat'): Promise<ExtractionResult> {
  const clean = texts.map(t => t.trim()).filter(Boolean);
  if (clean.length === 0) return { preferences: {}, items: [], dropped: 0 };
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: buildExtractionUserPrompt(clean, language) },
    ],
  });
  return parseExtraction(res.choices[0]?.message?.content ?? '', clean);
}
