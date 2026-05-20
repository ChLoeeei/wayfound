# Wayfound — 一期 MVP 开发 Spec

> 本文档把 [travel-agent-PRD.md](./travel-agent-PRD.md) §8 一期清单拆成可执行 sprint，并按 PRD §7 的三维测试框架（Deterministic / Fuzzy LLM-as-Judge / Subjective）为每个 sprint 定义验收标准。
>
> **测试维度速查（来自 PRD §7）：**
> - **Deterministic** — Jest 单元测试 + Playwright E2E，有标准答案、可量化
> - **Fuzzy** — DeepSeek 作为 Judge，按 7 维度 Rubric 评分；加权总分 ≥ 3.5/5.0 通过；50 case 通过率 ≥ 80%
> - **Subjective** — 人工审核或真实用户反馈

---

## Sprint 0 — 地基（已完成）

**已交付：**
- 目录扁平化为 `/Users/macsg/Desktop/wayfound/`
- 项目重命名 wanderlust → wayfound
- AI provider：Gemini → DeepSeek（OpenAI 兼容协议，model: `deepseek-chat`）
- 后端：Firebase → Supabase（Google OAuth + Postgres `itineraries` 表）
- 环境变量统一：`DEEPSEEK_API_KEY` / `AMAP_API_KEY` / `AMAP_SECURITY_CODE` / `SUPABASE_URL` / `SUPABASE_ANON_KEY`
- `npm install` + `tsc --noEmit` 通过

**遗留收尾（进入 Sprint 1 前完成）：**
- [ ] 在 Supabase Dashboard 建 `itineraries` 表 + RLS policy
- [ ] 在 Supabase 配 Google OAuth provider（Authorized origin: `http://localhost:3000`）
- [ ] 接入 Jest + Playwright 测试框架骨架（仅安装与一个 smoke test）

---

## Sprint 1 — 表单 + 数据模型重构

**目标：** 把表单从 demo 的 4 字段扩展到 PRD §3.1 的 6 字段，重构数据结构对齐 PRD §3.2 的 `Day → TimeSlot → Place` 模型。

### 范围

**前端表单（PRD §3.1）：**
- 目的地（带自动补全，调用高德输入提示 API）
- 出发日期 + 结束日期（日历选择器）
- 出行人数（数字步进器）+ 类型选择（家庭/情侣/朋友/独行）
- Vibe 多选标签（自然/人文/美食/购物/休闲/探险）
- 预算范围（滑动区间，人均/天）
- 特殊需求（多选：无障碍/素食/带婴儿/宠物友好）

**数据模型重构（PRD §3.2 / §5.3）：**
- `types.ts` 新增 `TimeSlot` 与新版 `Place`、`Day`、`Itinerary`
- 保留旧 `Activity` 类型作 demo 渲染兼容（Sprint 3 一并清理）

**AI 追问（PRD §3.1）：**
- 表单提交后，模糊字段触发气泡式追问（最多 2 个）
- 追问规则示例：Vibe="休闲" → 自然 vs 城市咖啡馆；人数 ≥ 4 → 是否有小孩
- 用户可"跳过直接生成"

### 验收标准

**Deterministic（Jest + Playwright）：**
| 测试项 | 标准 |
|---|---|
| 表单字段缺必填项 → 提交按钮 disabled | 100% 通过 |
| 日期选择：结束日期不能早于出发日期 | 100% 通过 |
| 日期换算成 days 数正确（如 5/20–5/24 → 5 天） | 100% 通过 |
| Vibe 多选状态切换正确 | 100% 通过 |
| 预算区间滑动控件返回值合法（min ≤ max） | 100% 通过 |
| 追问规则触发：填模糊词 → 出现追问气泡 | ≥ 95% 命中率 |
| `Itinerary` 类型符合 PRD §5.3 schema | tsc 严格模式通过 |

**Fuzzy：** 不涉及 AI 输出，本 sprint 跳过。

**Subjective：**
- 表单视觉是否符合 PRD §4.1 暖色系风格（人工审核）
- 追问语气是否自然（人工审核 5 条样本）

### 关键文件
- `src/types.ts` — 数据模型
- `src/components/PlanningForm.tsx`（新增）
- `src/components/AIClarification.tsx`（新增，追问气泡）

---

## Sprint 2 — DeepSeek Tool-use Agent + 行程生成

**目标：** 实现 PRD §6 的 Tool-use Agent，DeepSeek 自决调用工具集生成行程。

### 范围

**后端工具集（PRD §6.2）：**
| 工具 | 优先级 | 数据源 |
|---|---|---|
| `search_places` | P0 | 高德 Web Service API |
| `get_poi_details` | P0 | 高德 Web Service API |
| `calculate_distance` | P0 | 高德距离测量 API |
| `get_weather` | P1 | OpenWeather API |
| `validate_itinerary` | P1 | DeepSeek as Judge |
| `search_flights` | P2（二期） | Amadeus |
| `search_hotels` | P2（二期） | Booking |

**Agent 流程（PRD §6.3）：**
1. `get_weather` → 标记不适合户外的日期
2. 并行 `search_places` → 按 vibe 筛景点 / 餐厅
3. `calculate_distance` → 优化动线聚集度
4. DeepSeek 规划 → 按 Day + TimeSlot 组织
5. `validate_itinerary` → Rubric 评分，不达标自动修正一次

**实现要点：**
- 使用 OpenAI SDK 的 function calling（DeepSeek 兼容）
- `server.ts` `/api/generate-itinerary` 改造为 agent 循环（最多 N 步）
- 输出严格符合 PRD §5.3 `Itinerary` schema

### 验收标准

**Deterministic：**
| 测试项 | 标准 |
|---|---|
| 行程天数 = 用户输入天数 | 100% 匹配 |
| 每天包含早中晚三个 TimeSlot 字段 | 覆盖率 ≥ 95% |
| 地点坐标在目的地行政区范围内 | 错误率 ≤ 1% |
| `/api/generate-itinerary` 总耗时 | P95 ≤ 10s |
| `search_places` 单次响应 | P95 ≤ 2s |
| 输出 JSON 通过 schema 校验 | 100% |

**Fuzzy（PRD §7.3 — 本 sprint 重点）：**
- 50 个测试 case，覆盖：
  - 国内 / 海外目的地各 25
  - 1–14 天均匀分布
  - 6 种 vibe 组合
  - 不同人数类型（独行 / 情侣 / 家庭 / 朋友）
- 用 PRD §7.3 提供的 7 维 Rubric Prompt 喂给 DeepSeek 裁判
- **通过门槛：**
  - 加权总分 ≥ 3.5 / 5.0（每 case）
  - 50 case 通过率 ≥ 80%
- 失败 case 全部存入 `tests/fuzzy/regression/` 作回归集

**Subjective：**
- AI 推荐理由（`aiNote`）是否自然，人工抽审 10 条

### 关键文件
- `server.ts` — agent 主循环
- `server/tools/*.ts`（新增）— 每个工具一个文件
- `tests/fuzzy/judge.ts`（新增）— Rubric 评分调用
- `tests/fuzzy/cases.json`（新增）— 50 case 数据集

---

## Sprint 3 — 行程列表 UI + 地图联动

**目标：** PRD §3.2 的 Day + TimeSlot 列表渲染，PRD §4.2 的左右联动选中。

### 范围

- 行程列表按 Day 分组，每 Day 内按 TimeSlot（上午/下午/晚上）分组
- 地点卡片采用 PRD §4.3 的 C 方案（封面图 + 名称 + 评分 + 类型 + 时长）
- 卡片点击展开：AI 备注 / 开放时间 / 外链
- 地图 ↔ 列表双向联动：
  - 点击卡片 → 地图对应 pin 高亮放大、地图居中
  - 点击 pin → 列表滚动至卡片
- 当前选中 Day 的所有 pin 用动线连线
- 清理 demo 残留的 `Activity` 平铺结构

### 验收标准

**Deterministic：**
| 测试项 | 标准 |
|---|---|
| Day 数与 TimeSlot 渲染数一致 | 100% |
| 地图 pin 数量 = 当前 Day 地点数 | 100% |
| 点击卡片 → pin 缩放 class 切换 | Playwright 通过 |
| 点击 pin → 卡片获得 selected 状态 | Playwright 通过 |
| 切换 Day → 地图自动 fitView 到该 Day pin 集 | 100% |

**Fuzzy：** 本 sprint 不涉及 AI 输出。

**Subjective：**
- 卡片视觉与 PRD §4.3 设计是否对齐（人工审核）
- 联动响应延迟体感（人工评 1–5 分，目标 ≥ 4）

### 关键文件
- `src/components/ItineraryPane.tsx` — 重写按 TimeSlot 分组
- `src/components/PlaceCard.tsx`（替换 ActivityCard）
- `src/components/MapPane.tsx` — 加动线 polyline

---

## Sprint 4 — 编辑能力 + 搜索添加地点

**目标：** PRD §3.4 一期编辑操作 + PRD §3.3 方式 A 搜索添加。

### 范围

**编辑操作（PRD §3.4 一期）：**
- 长按拖拽：跨天、跨 TimeSlot 移动地点（用 `dnd-kit`）
- 左滑删除（移动端）+ 卡片内删除按钮（桌面）
- 卡片内下拉切换 TimeSlot（上午/下午/晚上）
- TimeSlot 内点击"+ 添加"插入新地点

**搜索添加地点（PRD §3.3 方式 A）：**
- 关键词输入 → 高德 PlaceSearch 返回候选列表
- 候选项展示：图片 / 名称 / 评分 / 地址 / 类型
- 选中后写入指定 Day + TimeSlot

**地图选址（PRD §3.3 方式 B）放二期。**

### 验收标准

**Deterministic：**
| 测试项 | 标准 |
|---|---|
| 拖拽 A 卡片到 B 位置后顺序正确 | 100% |
| 跨 Day 移动后两 Day 数据均更新 | 100% |
| 删除后 itinerary state 长度 -1 | 100% |
| TimeSlot 切换后卡片归类正确 | 100% |
| 搜索 API P95 响应时间 | ≤ 2s |
| 添加地点后地图自动 pin | 100% |
| 编辑操作不破坏 Itinerary schema | 100% |

**Fuzzy：** 本 sprint 不涉及 AI 输出。

**Subjective：**
- 拖拽手感（移动端真机测试）

### 关键文件
- `src/components/PlaceCard.tsx` — 加 dnd handle、删除、TimeSlot 选择器
- `src/components/PlaceSearchModal.tsx`（新增）
- `src/lib/itineraryOps.ts`（新增） — 纯函数：move / delete / insert / changeSlot

---

## Sprint 5 — 移动端半屏抽屉布局

**目标：** PRD §4.2 移动端核心交互。

### 范围

- 上半屏地图常驻 / 下半屏行程列表，中间分割条可拖
- 手指下滑 → 地图扩大；上滑 → 列表展开
- 列表顶端 Day Tab 横滑切换
- 卡片点击 / pin 点击的联动延续 Sprint 3
- 桌面端布局保持现状

### 验收标准

**Deterministic：**
| 测试项 | 标准 |
|---|---|
| 拖拽分割条改变 split ratio | 100% |
| 移动端视口宽 < 768px 时启用抽屉布局 | 100% |
| Day Tab 横滑切换正确 | 100% |
| 桌面端布局保持三栏不变 | 100% |

**Fuzzy：** 不涉及。

**Subjective：**
- iPhone / Android 真机测试（PRD §7.4 — 用户测试录屏）
- 拖拽流畅度（≥ 4 / 5）

### 关键文件
- `src/components/MobileLayout.tsx`（新增）
- `src/hooks/useDrawerSplit.ts`（新增）

---

## Sprint 6 — 账号 + 云端保存 + 导出

**目标：** PRD §3.7 一期数据存储与导出。

### 范围

**账号（沿用 Sprint 0 已搭好的 Supabase）：**
- Google 一键登录
- 行程列表页（"我的攻略"）
- 多设备同步：登录后自动 load

**导出：**
- 长图（DOM → Canvas，用 `html-to-image`）
- PDF（用 `jspdf` + 长图）
- 分享链接（Supabase row + `is_public=true` + 只读路由）

### 验收标准

**Deterministic：**
| 测试项 | 标准 |
|---|---|
| Google 登录成功率 | ≥ 99% |
| 保存→读取数据一致 | 100% |
| 多设备同步延迟 | ≤ 2s |
| 长图生成成功率 | ≥ 99% |
| PDF 文件可正常打开 | 100% |
| 分享链接未登录可访问只读视图 | 100% |
| 分享链接他人无法编辑（RLS） | 100% |

**Fuzzy：** 不涉及。

**Subjective（PRD §7.4）：**
- 导出长图视觉质量（人工评审，≥ 4 / 5）
- 分享链接落地页易用性

### 关键文件
- `src/components/MyTripsPanel.tsx`（新增）
- `src/lib/export.ts`（新增）
- `src/pages/share/[id].tsx`（新增只读路由）

---

## 总测试矩阵

| Sprint | Deterministic | Fuzzy | Subjective |
|---|:-:|:-:|:-:|
| 1 表单 + 数据模型 | ✅ | — | ✅ 视觉 |
| 2 Agent + 生成 | ✅ | ✅ **重点** | ✅ AI 文案 |
| 3 列表 + 地图联动 | ✅ | — | ✅ 视觉 |
| 4 编辑 + 搜索 | ✅ | — | ✅ 手感 |
| 5 移动端抽屉 | ✅ | — | ✅ 真机 |
| 6 账号 + 导出 | ✅ | — | ✅ 视觉 |

**E2E 关键路径（PRD §7.2，每 sprint 都跑）：**
```
输入目的地 → AI 生成行程 → 添加一个地点 →
拖拽调整顺序 → 查看地图联动 → 导出 PDF
→ 全程无报错，数据一致性验证通过
```

**Fuzzy 集成进 CI（Sprint 2 起）：**
- 每次 PR 抽样 10 case 跑（节省 token）
- main 分支每日全量 50 case
- 通过率跌破 80% → 阻塞合并

---

## 依赖关系

```
Sprint 0 ─┬─ Sprint 1 (表单+数据模型) ─┬─ Sprint 2 (Agent生成) ─┬─ Sprint 3 (列表+地图)
          │                            │                       │
          └─── (Supabase 配置) ────────┘                       └─ Sprint 4 (编辑+搜索)
                                                                  │
                                              Sprint 5 (移动端) ──┤
                                                                  │
                                             Sprint 6 (账号+导出) ┘
```

Sprint 3 和 Sprint 4 可部分并行（PlaceCard 是共同接触点，需先冻结接口）。

---

*文档与 PRD 同步演进；每个 sprint 完成后回填实际验收数据。*
