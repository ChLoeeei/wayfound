# Wayfound

> Find your way, anywhere.

AI 旅行行程规划工具。表单驱动生成 → 地图与列表双屏联动 → 自由编辑。

## Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **Map:** 高德地图 JS API（国内）/ Mapbox（国际，待接）
- **AI:** DeepSeek（Tool-use Agent）
- **Backend:** Supabase（Auth + Postgres + Storage）
- **Deploy:** Vercel

## Run Locally

```bash
npm install
npm run dev
```

## Environment

复制 `.env.example` 为 `.env` 并填写：

- `DEEPSEEK_API_KEY` — DeepSeek API key
- `AMAP_API_KEY` — 高德 Web JS API key
- `AMAP_SECURITY_CODE` — 高德 Web 安全密钥
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon public key

Supabase 建表与 OAuth 配置见 [`docs/SUPABASE_SETUP.md`](./docs/SUPABASE_SETUP.md)。

## Testing

- **Unit / Component（Vitest）：**
  ```bash
  npm run test          # 单次跑
  npm run test:watch    # watch 模式
  npm run test:ui       # 浏览器 UI
  ```
- **E2E（Playwright）：**
  ```bash
  # 首次需要下载 chromium，国内网络可能慢，可以等网络稳定后再装：
  PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright npx playwright install chromium

  npm run test:e2e
  ```
