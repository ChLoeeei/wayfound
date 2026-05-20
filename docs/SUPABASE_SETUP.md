# Supabase 配置指南

> Wayfound 用 Supabase 处理账号（Google OAuth）和行程持久化。本文档列出从零搭好后端的步骤。

## 1. 创建项目

1. 打开 https://supabase.com/dashboard
2. New project → 命名 `wayfound`，选离用户最近的 region（国内用户建议 `ap-northeast-1` 东京）
3. 设置 DB 密码，记下来
4. 等待 ~2 分钟初始化完成

## 2. 拿 API Keys

进入 **Project Settings → API**：

- `Project URL` → `.env` 里的 `SUPABASE_URL`
- `anon public` key → `.env` 里的 `SUPABASE_ANON_KEY`

```env
# .env
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

## 3. 建表 + RLS

进入 **SQL Editor**，把 [`supabase/migrations/0001_itineraries.sql`](../supabase/migrations/0001_itineraries.sql) 整个粘进去执行。

执行后应该能在 **Table Editor** 看到 `itineraries` 表，且开了 RLS。

**表结构：**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid pk | 自动生成 |
| `user_id` | uuid → auth.users | 行程归属用户 |
| `payload` | jsonb | 完整 Itinerary 对象 |
| `is_public` | bool | 是否公开（分享链接用） |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | trigger 自动更新 |

**RLS 策略：**
- 用户能读/写/删自己的行程
- 任何人（包括未登录）能读 `is_public = true` 的行程

## 4. 配 Google OAuth

### 4.1 在 Google Cloud Console 建 OAuth client

1. https://console.cloud.google.com/apis/credentials
2. Create credentials → OAuth client ID → Web application
3. **Authorized JavaScript origins：**
   - `http://localhost:3000`（开发）
   - 生产域名（部署后补）
4. **Authorized redirect URIs：**
   - `https://<你的-supabase-project>.supabase.co/auth/v1/callback`
   - 这个 URL 在 Supabase Dashboard → Authentication → Providers → Google 那里能直接看到，复制过去
5. 创建后拿到 `Client ID` 和 `Client Secret`

### 4.2 在 Supabase 启用 Google provider

1. Supabase Dashboard → **Authentication → Providers**
2. 找到 Google → 打开 Enable
3. 填入上一步拿到的 `Client ID` 和 `Client Secret`
4. 保存

### 4.3 配 Site URL

**Authentication → URL Configuration**：
- Site URL：`http://localhost:3000`（开发期）
- Redirect URLs：加 `http://localhost:3000/**`

## 5. 验证

跑 `npm run dev` → 点登录按钮 → 应该跳到 Google OAuth 同意页 → 授权后回到本地 → `auth.users` 表里应该出现新行。

## 6. 后续

- 部署到 Vercel 后，把生产域名加进 Google OAuth 的 origins/redirects 和 Supabase 的 Redirect URLs
- 行程导出公开链接时，前端要把 `is_public` 设为 true（Sprint 6）
