# Google 登录功能 运行/检查结果报告

- 项目：Inspire（self-inspiring-tarot）
- 功能：Google 账号注册/登录 + 用户记录持久化 + 会话管理
- 报告日期：2026-08-27（America/Los_Angeles）
- 代码基线：`main` 分支，包含提交 `9fb5675`（功能实现）与 `f3178a2`（KV 配置修复）
- 生产部署：https://inspire.joechenst.workers.dev （Version `6528a9d5-225c-400e-b687-05821c628a20`）

## 一、结论速览

| 验收标准 | 结论 | 关键证据 |
|---|---|---|
| Google 注册/登录可用 | ✅ 通过 | E2E 12/12 步通过；首登落地 `/account?lang=zh&welcome=1`，再登无 welcome（识别老用户） |
| 用户记录可保存可查询 | ✅ 通过 | D1 `users` 表含 google_id/email/name/created_at/last_login_at；审计查询函数 + SQL 均可用 |
| 重复登录不产生重复账号 | ✅ 通过 | 同一 Google 账号两次登录后 D1 仍为 1 行；单测覆盖并发注册竞态（5 并发仅 1 行） |
| 登录失败有友好提示 | ✅ 通过 | 取消授权/伪造 state/缺少 code/Google 服务 500/邮箱未验证 5 条失败路径全部返回友好文案，且不留脏数据 |
| 凭据与回调安全 | ✅ 通过 | 密钥仅来自环境变量；state 参数 httpOnly Cookie + 常量时间比较校验 |
| 运行/检查报告 | ✅ 本文档 | 附 HTML 版本 |
| 未登录浏览不受影响 | ✅ 通过 | 生产首页 200、塔罗牌库 200；邮箱密码/Stripe/配额逻辑零改动 |
| 部署与回滚文档 | ✅ 通过 | 见《Google 登录部署与交接文档》（md + HTML） |

## 二、测试环境与方法

- 单元测试：vitest（Node 22 + `node:sqlite` 内存版 D1 仿真层，真实执行 SQL）— `npm test` → **7 个文件 43 个用例全部通过**（其中本次新增 21 个：`google.test.ts` 13 个、`users-google.test.ts` 8 个）。
- 端到端测试：本地 `wrangler dev`（:8787，绑定本地 D1 与 KV）+ 模拟 Google 身份提供方（`scripts/mock-google-server.mjs`，:9000，支持授权码签发、取消授权、token/userinfo 故障注入、测试档案切换），驱动脚本 `scripts/e2e-google-login.mjs`（12 步）与 `scripts/e2e-google-link.mjs`（邮箱关联）。
- 生产验证：部署后对 `https://inspire.joechenst.workers.dev` 做 HTTP 探测（首页/牌库/登录页/OAuth 入口）。
- 原始证据：`.e2e/e2e-google-login.log`、`.e2e/e2e-google-link.log`、`.e2e/d1-users.json`。

## 三、登录主流程验证（E2E 12/12 全部通过）

| # | 步骤 | 期望 | 实际结果 |
|---|------|------|----------|
| 1 | 打开 `/login` | 展示 Google 登录入口 | ✅ 200，含 `/api/auth/google/start` 链接 |
| 2 | 打开 `/signup` | 展示 Google 注册入口 | ✅ 200 |
| 3 | 点击 Google 按钮 | 302 跳转 Google 授权页，带 client_id/redirect_uri/state，写入 oauth_state Cookie | ✅ state 长度 ≥30 字符，Cookie 属性 httpOnly+Secure+SameSite=Lax |
| 4 | 首次授权（新用户） | 自动注册并登录，落地 `/account?lang=zh&welcome=1` | ✅ 会话 Cookie 签发 |
| 5 | 账户页 | 显示 Google 昵称/邮箱/徽章 | ✅ "Test Google User" + test.google@gmail.com + Google 徽章 |
| 6 | 登出 + 导航状态 | Cookie 清除，导航切回 Log in | ✅ |
| 7 | 第二次 Google 登录 | 直接登录，无 welcome（识别已有账号） | ✅ `/account?lang=zh` |
| 8 | 用户在 Google 页取消授权 | 友好提示可重试 | ✅ 302 → `/login?error=cancelled`，页面渲染"你取消了 Google 授权…" |
| 9 | 伪造 state 回调 | 拒绝（防 CSRF） | ✅ 302 → `/login?error=invalid_state` |
| 10 | 回调缺少 code | 拒绝 | ✅ 302 → `/login?error=oauth_failed` |
| 11 | Google token 接口故障（模拟网络/服务中断） | 友好报错，可重试 | ✅ 302 → `/login?error=oauth_failed` |
| 12 | 邮箱未验证的 Google 账号 | 拒绝且不建号 | ✅ 302 → `/login?error=oauth_failed`，D1 无该账号记录 |

## 四、数据持久化验证（D1 实查）

`npx wrangler d1 execute inspire-readings --local --command "SELECT email, google_id, name, length(password_hash) AS pw_len, created_at, last_login_at FROM users ORDER BY created_at"`（快照存于 `.e2e/d1-users.json`）：

| email | google_id | name | pw_len | created_at | last_login_at |
|---|---|---|---|---|---|
| link.test@gmail.com | google-link-777 | Link Test | 69（原密码哈希保留） | 2026-08-28 04:41:01 | 2026-08-28 04:58:35 |
| test.google@gmail.com | google-1111111111111111 | Test Google User | 0（Google 专属账号，密码哈希为空串、不可用于密码登录） | 2026-08-28 04:59:58 | 2026-08-28 04:59:59 |

结论：

- 字段完整性：每条记录含 Google 用户 ID、姓名、邮箱、created_at、last_login_at ✅
- 无重复：同一 Google 账号两次登录后仍为 1 行；`last_login_at` 每次登录刷新、`created_at` 永不变更 ✅
- 邮箱关联：先注册的密码账号（pw_len=69）在 Google 登录后被关联 `google_id`，密码哈希原样保留、无覆盖 ✅
- 审计路径：代码层提供 `getUserByEmail` / `listUsers`；运维层可直接 `wrangler d1 execute` 查询 ✅

## 五、失败路径与数据一致性

- 所有失败分支都在“写库之前”或“事务性单条 upsert”内发生：取消授权/state 校验失败/code 缺失发生在任何数据库写入之前；token/userinfo 失败时 catch 返回，不落库。
- 数据库层竞态：INSERT 捕获唯一约束冲突后按 google_id/email 重新匹配更新（单测：5 个并发注册同一账号 → 全部返回同一 id，表中 1 行）。
- 未验证邮箱：直接拒绝，D1 中确认无残留记录。

## 六、安全检查

| 检查项 | 结果 | 代码位置 |
|---|---|---|
| client_secret 不硬编码 | ✅ 仅从 `env.GOOGLE_CLIENT_SECRET` 读取 | `src/pages/api/auth/google/callback.ts` |
| state 防 CSRF | ✅ 24 字节随机 base64url，httpOnly Cookie（Path 限定回调路由，10 分钟过期），常量时间比较，用后即删 | `src/lib/google.ts`、`start.ts`、`callback.ts` |
| 密钥不进仓库 | ✅ `.dev.vars`/.env 均被 .gitignore 忽略；示例文件仅占位符 | `.gitignore`、`.dev.vars.example` |
| 未验证邮箱不可冒名关联 | ✅ `email_verified !== true` 直接拒绝 | `callback.ts` |
| Google 专属账号不可用密码登录 | ✅ password_hash 为空串，PBKDF2 校验恒为 false（单测覆盖） | `users.ts`、`users-google.test.ts` |
| OAuth 回调仅接受本站回调地址 | ✅ redirect_uri 与授权请求一致，由服务端生成 | `start.ts`/`callback.ts` |

进一步加固建议（非本期范围）：id_token 的 JWKS 签名校验、登录接口限流、账号关联时的邮件通知。

## 七、兼容性验证

- 认证流程为纯服务端渲染 + 标准 `<a>`/`<form>` 跳转，**不依赖 JavaScript**，任何现代浏览器（及禁用 JS 环境）均可完成登录。
- 页面 HTML 结构经 HTTP 响应校验（登录/注册/账户页均 200 且关键字段渲染正确）；响应式沿用站点既有 CSS（`@media (max-width:700px)` 下认证页转单列、收益列表居中）。
- 说明：本次未在真实浏览器矩阵（Safari/Firefox 移动端等）逐一截图回归；如需上线级回归可后续接入 Playwright（协议 lite 层未包含，未自动执行）。

## 八、生产部署状态

- 已部署：https://inspire.joechenst.workers.dev （首页 200、牌库 200、登录页含 Google 入口、OAuth 入口在未配置密钥时优雅返回 `/login?error=config`）。
- 待管理员完成（一次性）：在 Google Cloud Console 创建 OAuth 客户端并将回调地址设为 `https://<你的域名>/api/auth/google/callback`，然后 `npx wrangler secret put GOOGLE_CLIENT_ID` 与 `npx wrangler secret put GOOGLE_CLIENT_SECRET`。详见部署文档。
