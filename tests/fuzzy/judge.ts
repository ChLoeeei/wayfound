/**
 * Fuzzy LLM-as-Judge scoring per PRD §7.3.
 * 7 dimensions, weighted total ≥ 3.5/5.0 → pass.
 */

import OpenAI from 'openai';

export const RUBRIC_DIMENSIONS = [
  'route_logic',         // 动线合理性
  'time_allocation',     // 时间分配
  'meal_coverage',       // 餐食覆盖
  'physical_intensity',  // 体力强度匹配
  'budget_match',        // 预算匹配
  'preference_match',    // 取向匹配
  'weather_adaptation',  // 天气适配
] as const;

export type RubricDim = (typeof RUBRIC_DIMENSIONS)[number];

export const WEIGHTS: Record<RubricDim, number> = {
  route_logic: 0.20,
  time_allocation: 0.20,
  meal_coverage: 0.10,
  physical_intensity: 0.10,
  budget_match: 0.10,
  preference_match: 0.20,
  weather_adaptation: 0.10,
};

export const PASS_THRESHOLD = 3.5;

export interface DimScore {
  score: number;
  reason: string;
}

export interface RubricResult {
  scores: Record<RubricDim, DimScore>;
  weighted_total: number;
  pass: boolean;
}

export function weightedTotal(scores: Record<RubricDim, DimScore>): number {
  let total = 0;
  for (const dim of RUBRIC_DIMENSIONS) {
    total += (scores[dim]?.score ?? 0) * WEIGHTS[dim];
  }
  return Math.round(total * 100) / 100;
}

const RUBRIC_PROMPT = `你是一名资深旅游规划师，请按照以下 7 个维度对这份行程进行评分。
每个维度给出 1-5 分（1=差，3=中，5=好），并给出简短理由（一句话即可）。
只返回 JSON，不要有其他内容，不要 markdown fences。

7 个维度的含义：
- route_logic（动线合理性）：路线是否顺畅，相邻地点是否地理集中
- time_allocation（时间分配）：每天是否 3-4 个地点，节奏是否合理
- meal_coverage（餐食覆盖）：早中晚是否均有安排且时间合理
- physical_intensity（体力强度匹配）：是否匹配用户的出行类型（家庭/独行等）
- budget_match（预算匹配）：推荐费用是否在预算范围内
- preference_match（取向匹配）：景点/餐厅类型是否符合用户 vibes
- weather_adaptation（天气适配）：是否考虑了出行季节，雨季是否避免大量户外

返回格式：
{
  "scores": {
    "route_logic": { "score": N, "reason": "..." },
    "time_allocation": { "score": N, "reason": "..." },
    "meal_coverage": { "score": N, "reason": "..." },
    "physical_intensity": { "score": N, "reason": "..." },
    "budget_match": { "score": N, "reason": "..." },
    "preference_match": { "score": N, "reason": "..." },
    "weather_adaptation": { "score": N, "reason": "..." }
  }
}`;

export interface JudgeRequest {
  userProfile: unknown;
  itinerary: unknown;
}

export async function judgeItinerary(
  req: JudgeRequest,
  client: OpenAI,
  model: string = 'deepseek-chat',
): Promise<RubricResult> {
  const userMessage = `用户信息：${JSON.stringify(req.userProfile)}\n\n行程内容：${JSON.stringify(req.itinerary)}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: RUBRIC_PROMPT },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);

  // Be defensive about missing dimensions.
  const scores = {} as Record<RubricDim, DimScore>;
  for (const dim of RUBRIC_DIMENSIONS) {
    const raw = parsed.scores?.[dim];
    scores[dim] = {
      score: clamp(parseFloat(raw?.score) || 0, 0, 5),
      reason: typeof raw?.reason === 'string' ? raw.reason : '',
    };
  }

  const total = weightedTotal(scores);
  return {
    scores,
    weighted_total: total,
    pass: total >= PASS_THRESHOLD,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
