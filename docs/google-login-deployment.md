# Google 登录 部署与交接文档

- 适用项目：Inspire（self-inspiring-tarot，Astro 7 SSR + Cloudflare Workers + D1 + KV）
- 功能范围：Google 账号注册/登录、用户记录持久化（D1 `users` 表）、会话管理（HMAC 签名 Cookie）
- 配套文档：《google-login-run-check-report》（运行/检查结果报告）

## 1. 架构与涉及文件

| 模块 | 文件 | 说明 |
|---|---|---|
| OAuth 库 | `src/lib/google.ts` | 授权 URL、code 换 token、userinfo、state 生成与校验 |
| 路由 | `src/pages/api/auth/google/start.ts` / `callback.ts` | 发起授权 / 回调处理与建会话 |
| 数据层 | `src/lib/users.ts` | `users` 表建表/迁移/查询/upsert |
| 前端 | `src/pages/login.astro`、`signup.astro`、`account.astro`、`src/layouts/Layout.astro`、`src/styles/global.css` | 登录入口、错误提示、账户资料、导航状态 |
| 环境类型 | `src/env.d.ts`、`.dev.vars.example` | GOOGLE_* 变量声明与本地示例 |
| 测试 | `src/lib/__tests__/google.test.ts`、`users-google.test.ts`、`scripts/e2e-google-login.mjs`、`scripts/e2e-google-link.mjs`、`scripts/mock-google-server.mjs` | 单测 + E2E + 模拟 Google IdP |

登录链路：浏览器点击 Google 按钮 → `/api/auth/google/start`（生成 state 写入 Cookie，302 到 Google）→ 用户授权 → `/api/auth/google/callback`（校验 state → code 换 token → 拉取档案 → `upsertGoogleUser` 落库 → 签发 session Cookie）→ `/account`。

## 2. 环境变量

| 变量 | 必填 | 来源 | 说明 |
|---|---|---|---|
| `SESSION_SECRET` | 是（已有） | 现有配置 | 会话签名密钥，保持不变 |
| `GOOGLE_CLIENT_ID` | 是 | Google Cloud Console | OAuth 客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 是 | Google Cloud Console | OAuth 客户端密钥（用 `wrangler secret put` 设置，勿写入仓库） |
| `GOOGLE_REDIRECT_URI` | 建议 | 自定义 | 默认由请求来源自动推导 `<origin>/api/auth/google/callback`；多域名或反代场景才需要显式指定 |
| `GOOGLE_AUTH_URL` / `GOOGLE_TOKEN_URL` / `GOOGLE_USERINFO_URL` | 否 | 仅本地测试 | 覆盖 Google 端点指向本地模拟 IdP；生产环境**必须不设置** |

本地开发：复制 `.dev.vars.example` 为 `.dev.vars` 填入上述值（该文件已被 .gitignore 忽略）。

## 3. Google Cloud Console 配置（一次性，管理员操作）

1. 打开 [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)。
2. 创建 OAuth consent screen（External，填应用名与支持邮箱）。
3. 创建 OAuth client ID → 类型 **Web application**。
4. Authorized redirect URIs 精确填写（协议、域名、路径必须完全一致）：
   - `https://inspire.joechenst.workers.dev/api/auth/google/callback`
   - 如绑定自定义域名，为每个域名再各加一条。
5. 记录 Client ID / Client Secret，执行：
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
6. 发布状态如为 Testing，仅测试名单内账号可登录；正式开放请 Publish。

## 4. 数据库初始化与迁移

`users` 表最终结构：

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_id TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
```

- **无需手工迁移**：应用启动后首次请求会 `CREATE TABLE IF NOT EXISTS` 并对旧库逐条 `ALTER TABLE ADD COLUMN`（重复执行安全，重复列报错被忽略），另建 `idx_users_google_id` 唯一索引。
- 如需手工预执行（生产 D1）：
  ```bash
  npx wrangler d1 execute inspire-readings --remote --command "ALTER TABLE users ADD COLUMN google_id TEXT; ALTER TABLE users ADD COLUMN name TEXT; ALTER TABLE users ADD COLUMN avatar_url TEXT; ALTER TABLE users ADD COLUMN last_login_at DATETIME; CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);"
  ```
  （仅对上线前已存在 `users` 表的旧库有意义；全新库会由应用自动建表。）
- KV：`SESSION` 绑定需真实命名空间（已创建：id `8c7ba8cc166749d49512d17cd856b45c`）。新环境重建时执行 `npx wrangler kv namespace create SESSION` 并把输出的 id 填入 `wrangler.jsonc`。
- D1 数据库：沿用现有 `inspire-readings`（id `2873b281-1d7c-4a82-8649-a91d912bbb0f`），无新库需求。

## 5. 部署步骤

### 方式 A：Cloudflare Workers Builds（当前启用的 CI）

1. 提交并推送 `main`（构建命令 `npm run build`，部署命令 `npx wrangler deploy`）。
2. CI 自动构建并发布，可在 Cloudflare Dashboard → Workers & Pages → inspire → Deployments 查看进度。
3. 注意：根 `wrangler.jsonc` 是唯一需要维护的配置；`dist/server/wrangler.json` 由构建自动生成，不要手改。

### 方式 B：本机手动部署

```bash
npm install
npm run build
npx wrangler deploy        # 需已 wrangler login
```

部署成功会输出版本号与 `https://inspire.joechenst.workers.dev`。

## 6. 部署后验证（冒烟清单）

```bash
# 1. 站点存活
curl -s -o /dev/null -w "%{http_code}\n" https://inspire.joechenst.workers.dev/            # 期望 200
# 2. 登录页含 Google 入口
curl -s https://inspire.joechenst.workers.dev/login | grep -c "/api/auth/google/start"     # 期望 ≥1
# 3. OAuth 入口（未配密钥时应优雅返回 config 错误；配好后应 302 到 accounts.google.com）
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://inspire.joechenst.workers.dev/api/auth/google/start
# 4. 数据审计
npx wrangler d1 execute inspire-readings --remote --command "SELECT email,google_id,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 10"
```

浏览器完成一次真实 Google 注册 → 登出 → 再登录，并在上一步 SQL 中确认只有一行记录、`last_login_at` 更新。

## 7. 回滚

- **代码回滚**：`git revert` 到上一个已验证提交并重新部署（CI 推送即自动部署；手动则再跑 `npm run build && npx wrangler deploy`），或在 Cloudflare Dashboard → inspire → Deployments 选择历史版本 **Rollback**（秒级生效，无需构建）。
- **数据库回滚**：本次全部为**增量变更**（新增可空列 + 新增索引），不修改/删除任何既有列与数据；回滚旧版代码后旧代码忽略新列，无需删列。如必须移除索引：`DROP INDEX IF EXISTS idx_users_google_id;`（列保留无害）。
- **密钥回滚**：Google 密钥泄露时在 Google Console 重置，并重跑 `wrangler secret put`。

## 8. 运行与开发（本地）

```bash
npm install
npm test                      # 43 个单元测试
npm run build                 # 构建
npx wrangler dev --port 8787  # 本地运行（读 .dev.vars；D1/KV 为本地模拟）
# E2E（需另开终端先运行 node scripts/mock-google-server.mjs）
node scripts/e2e-google-login.mjs http://localhost:8787 http://127.0.0.1:9000
node scripts/e2e-google-link.mjs  http://localhost:8787 http://127.0.0.1:9000
```

## 9. 后续迭代建议

- 登录接口限流（防止 state/token 接口被刷）。
- id_token JWKS 签名校验（当前以 userinfo 端点为准，已满足安全要求，属可选加固）。
- 账号被 Google 关联时发送邮件通知。
- 上线级浏览器兼容回归可接入 Playwright 截图脚本。
