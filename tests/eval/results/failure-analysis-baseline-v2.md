# Failure analysis: baseline-v2-test-d53bc8f558

90 runs over 30 cases. Reward ceiling is 0.8; "loss" is how far below it a term pulled the reward.

## Average reward loss per run, by term

| Term | Overall | Domestic | International |
|---|---:|---:|---:|
| Hallucination (0.5 × rate) | 0.009 | 0.011 | 0.007 |
| Tool correctness | 0.021 | 0.001 | 0.041 |
| Constraints | 0.000 | 0.000 | 0.000 |
| Judge | 0.038 | 0.038 | 0.038 |

## Runs per failure category

| Category | Runs | Domestic | International | Cases |
|---|---:|---:|---:|---|
| ungrounded | 2 | 2 | 0 | hefei-couple-leisure-food, xiamen-couple-leisure-food |
| tool-errors | 25 | 2 | 23 | amsterdam-couple-leisure-culture, bali-couple-nature-leisure, bangkok-family-food-leisure, barcelona-friends-culture-adventure, capetown-family-nature-adventure, kyoto-couple-culture-nature, london-solo-culture, mexicocity-solo-food-culture, osaka-friends-food-shopping, seoul-friends-shopping-food, sydney-solo-nature-adventure, taiyuan-family-culture, tokyo-family-food-culture, vienna-family-culture-leisure, xiamen-couple-leisure-food |
| judge-low | 15 | 8 | 7 | bali-couple-nature-leisure, barcelona-friends-culture-adventure, capetown-family-nature-adventure, paris-couple-culture-food, seoul-friends-shopping-food, shanghai-couple-food-shopping, shenzhen-solo-shopping, shijiazhuang-couple-culture-food, tokyo-family-food-culture, urumqi-friends-adventure-nature, zhengzhou-solo-culture-adventure |

## LLM-judge dimensions (mean over judged runs, weakest first)

| Dimension | Mean |
|---|---:|
| weather_adaptation | 3.67 |
| time_allocation | 3.70 |
| physical_intensity | 3.77 |
| route_logic | 3.82 |
| meal_coverage | 3.88 |
| budget_match | 4.19 |
| preference_match | 4.98 |

## Per case (mean reward over repeats, worst first)

| Case | Region | Days | Rewards | Mean | Issues |
|---|---|---:|---|---:|---|
| vienna-family-culture-leisure | international | 4 | 0.65 0.61 0.67 | 0.640 | tool-errors |
| seoul-friends-shopping-food | international | 4 | 0.61 0.69 0.69 | 0.662 | tool-errors, judge-low |
| bali-couple-nature-leisure | international | 7 | 0.66 0.66 0.66 | 0.662 | tool-errors, judge-low |
| xiamen-couple-leisure-food | domestic | 4 | 0.76 0.58 0.74 | 0.694 | ungrounded, tool-errors |
| barcelona-friends-culture-adventure | international | 5 | 0.67 0.73 0.69 | 0.696 | tool-errors, judge-low |
| capetown-family-nature-adventure | international | 7 | 0.68 0.70 0.75 | 0.709 | tool-errors, judge-low |
| tokyo-family-food-culture | international | 6 | 0.68 0.77 0.69 | 0.710 | tool-errors, judge-low |
| kyoto-couple-culture-nature | international | 5 | 0.68 0.69 0.76 | 0.713 | tool-errors |
| hefei-couple-leisure-food | domestic | 2 | 0.61 0.77 0.78 | 0.718 | ungrounded |
| sydney-solo-nature-adventure | international | 6 | 0.70 0.70 0.76 | 0.719 | tool-errors |
| london-solo-culture | international | 4 | 0.76 0.74 0.69 | 0.732 | tool-errors |
| osaka-friends-food-shopping | international | 3 | 0.70 0.76 0.74 | 0.734 | tool-errors |
| bangkok-family-food-leisure | international | 6 | 0.68 0.75 0.77 | 0.735 | tool-errors |
| mexicocity-solo-food-culture | international | 5 | 0.76 0.68 0.77 | 0.737 | tool-errors |
| shanghai-couple-food-shopping | domestic | 3 | 0.70 0.75 0.76 | 0.740 | judge-low |
| amsterdam-couple-leisure-culture | international | 3 | 0.77 0.77 0.69 | 0.740 | tool-errors |
| jinan-family-nature-culture | domestic | 3 | 0.74 0.73 0.76 | 0.744 | — |
| zhengzhou-solo-culture-adventure | domestic | 4 | 0.75 0.74 0.74 | 0.744 | judge-low |
| urumqi-friends-adventure-nature | domestic | 10 | 0.74 0.74 0.77 | 0.751 | judge-low |
| paris-couple-culture-food | international | 5 | 0.76 0.77 0.72 | 0.752 | judge-low |
| shijiazhuang-couple-culture-food | domestic | 1 | 0.73 0.76 0.78 | 0.755 | judge-low |
| taiyuan-family-culture | domestic | 3 | 0.74 0.76 0.76 | 0.755 | tool-errors |
| beijing-solo-history | domestic | 4 | 0.77 0.75 0.76 | 0.760 | — |
| dalian-family-leisure-nature | domestic | 4 | 0.76 0.76 0.76 | 0.761 | — |
| sanfrancisco-friends-food-shopping | international | 3 | 0.77 0.75 0.76 | 0.761 | — |
| shenzhen-solo-shopping | domestic | 3 | 0.75 0.77 0.77 | 0.763 | judge-low |
| chengdu-friends-food | domestic | 4 | 0.76 0.78 0.76 | 0.764 | — |
| guiyang-friends-nature-adventure | domestic | 4 | 0.75 0.77 0.77 | 0.764 | — |
| hangzhou-couple-nature | domestic | 3 | 0.77 0.77 0.76 | 0.768 | — |
| lanzhou-solo-food-culture | domestic | 2 | 0.78 0.77 0.77 | 0.772 | — |

## Run details

- **xiamen-couple-leisure-food r2** (reward 0.577): ungrounded, tool-errors — 8/25 places ungrounded (e.g. 八市（开禾路市场）, 日舞咖啡馆（鹭江道店）, 厦门大学（思明校区）); 2/26 tool calls errored, 0 unknown POI id ref(s)
- **hefei-couple-leisure-food r1** (reward 0.606): ungrounded — 4/13 places ungrounded (e.g. 一则咖啡（三孝口店）, 徽商故里（罍街店）, 木桶记臭鳜鱼·徽菜餐厅（南七店）)
- **vienna-family-culture-leisure r2** (reward 0.608): tool-errors — 5/26 tool calls errored, 5 unknown POI id ref(s)
- **seoul-friends-shopping-food r1** (reward 0.610): tool-errors — 7/36 tool calls errored, 7 unknown POI id ref(s)
- **vienna-family-culture-leisure r1** (reward 0.646): tool-errors — 1/28 tool calls errored, 1 unknown POI id ref(s)
- **bali-couple-nature-leisure r1** (reward 0.660): tool-errors — 5/42 tool calls errored, 5 unknown POI id ref(s)
- **bali-couple-nature-leisure r2** (reward 0.662): tool-errors, judge-low — 2/47 tool calls errored, 2 unknown POI id ref(s); judge 3.7, lowest: route_logic=3, time_allocation=3
- **bali-couple-nature-leisure r3** (reward 0.664): tool-errors, judge-low — 1/49 tool calls errored, 1 unknown POI id ref(s); judge 3.6, lowest: physical_intensity=2, time_allocation=3
- **vienna-family-culture-leisure r3** (reward 0.667): tool-errors — 3/27 tool calls errored, 3 unknown POI id ref(s)
- **barcelona-friends-culture-adventure r1** (reward 0.672): tool-errors — 4/30 tool calls errored, 4 unknown POI id ref(s)
- **tokyo-family-food-culture r1** (reward 0.677): tool-errors, judge-low — 1/43 tool calls errored, 1 unknown POI id ref(s); judge 3.6, lowest: route_logic=3, time_allocation=3
- **mexicocity-solo-food-culture r2** (reward 0.679): tool-errors — 3/27 tool calls errored, 3 unknown POI id ref(s)
- **kyoto-couple-culture-nature r1** (reward 0.682): tool-errors — 1/35 tool calls errored, 1 unknown POI id ref(s)
- **capetown-family-nature-adventure r1** (reward 0.683): tool-errors — 2/48 tool calls errored, 2 unknown POI id ref(s)
- **bangkok-family-food-leisure r1** (reward 0.684): tool-errors — 3/32 tool calls errored, 3 unknown POI id ref(s)
- **amsterdam-couple-leisure-culture r3** (reward 0.685): tool-errors — 2/32 tool calls errored, 2 unknown POI id ref(s)
- **tokyo-family-food-culture r3** (reward 0.686): tool-errors — 1/47 tool calls errored, 1 unknown POI id ref(s)
- **seoul-friends-shopping-food r3** (reward 0.686): tool-errors — 2/27 tool calls errored, 2 unknown POI id ref(s)
- **barcelona-friends-culture-adventure r3** (reward 0.689): tool-errors — 2/32 tool calls errored, 2 unknown POI id ref(s)
- **seoul-friends-shopping-food r2** (reward 0.691): judge-low — judge 3.4, lowest: weather_adaptation=2, route_logic=3
- **kyoto-couple-culture-nature r2** (reward 0.692): tool-errors — 2/37 tool calls errored, 2 unknown POI id ref(s)
- **london-solo-culture r3** (reward 0.693): tool-errors — 1/28 tool calls errored, 1 unknown POI id ref(s)
- **capetown-family-nature-adventure r2** (reward 0.696): tool-errors — 1/36 tool calls errored, 1 unknown POI id ref(s)
- **osaka-friends-food-shopping r1** (reward 0.698): tool-errors — 1/21 tool calls errored, 1 unknown POI id ref(s)
- **sydney-solo-nature-adventure r2** (reward 0.699): tool-errors — 1/34 tool calls errored, 1 unknown POI id ref(s)
- **sydney-solo-nature-adventure r1** (reward 0.702): tool-errors — 1/48 tool calls errored, 1 unknown POI id ref(s)
- **shanghai-couple-food-shopping r1** (reward 0.703): judge-low — judge 3.7, lowest: time_allocation=3, physical_intensity=3
- **paris-couple-culture-food r3** (reward 0.723): judge-low — judge 3.7, lowest: physical_intensity=2, time_allocation=3
- **barcelona-friends-culture-adventure r2** (reward 0.727): judge-low — judge 3.6, lowest: route_logic=3, time_allocation=3
- **shijiazhuang-couple-culture-food r1** (reward 0.728): judge-low — judge 3.2, lowest: time_allocation=2, physical_intensity=2
- **urumqi-friends-adventure-nature r2** (reward 0.736): judge-low — judge 3.6, lowest: route_logic=3, time_allocation=3
- **zhengzhou-solo-culture-adventure r2** (reward 0.740): judge-low — judge 3.5, lowest: budget_match=2, route_logic=3
- **urumqi-friends-adventure-nature r1** (reward 0.744): judge-low — judge 3.6, lowest: route_logic=3, time_allocation=3
- **zhengzhou-solo-culture-adventure r3** (reward 0.744): judge-low — judge 3.6, lowest: route_logic=3, time_allocation=3
- **capetown-family-nature-adventure r3** (reward 0.748): judge-low — judge 3.7, lowest: route_logic=3, physical_intensity=3
- **shenzhen-solo-shopping r1** (reward 0.748): judge-low — judge 3.7, lowest: route_logic=3, time_allocation=3
- **zhengzhou-solo-culture-adventure r1** (reward 0.748): judge-low — judge 3.7, lowest: time_allocation=3, physical_intensity=3
- **taiyuan-family-culture r2** (reward 0.759): tool-errors — 1/23 tool calls errored, 0 unknown POI id ref(s)

## Findings, and how the v3 hard cases target them

Written by hand from the tables above plus the run's tool diagnostics log (`tests/eval/reports/mapbox-errors-*.log`, gitignored).

1. **Constraints are saturated** (0.000 loss): every run fits the budget band and mentions every special need. The v2 cases never stress them. → v3 adds **tight budgets** on every hard case and **conflicting special needs** (vegetarian in meat-heavy cuisines, accessibility or a baby alongside adventure).
2. **International tool correctness is the largest agent-side loss** (0.041 per run, 23 of 45 international runs). In the diagnostics these are almost all `calculate_distance` calls with a POI id that search never returned ("Unknown POI id", 28 calls), i.e. the model misremembers or invents ids. → A strategy problem the learning loop can target; **multi-city** and **obscure-destination** cases add more searches and more ids to keep straight.
3. **The judge is the largest loss overall** (0.038 per run), concentrated in weather_adaptation, time_allocation and physical_intensity. → **Ultra-long** (12–14 days) and **conflicting-constraint** family cases stress pacing and intensity; **multi-city** stresses time allocation and route logic.
4. **Hallucination is low** (0.009) after the segmented-grounding fix (long trips 0–2%, 4 of 702 long-trip places still unverified). → **Obscure destinations** (Luang Prabang, Faroe Islands, Tbilisi) have sparse map data, where grounding is genuinely hard.
5. **No generation failures** remain on the original 30 cases.
