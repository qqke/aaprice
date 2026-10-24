# 降价提醒上线清单

## 1. 准备发件服务

1. 在 Resend 添加并验证发件域名。生产环境使用 `prices.stbf.online`。
2. 创建仅用于 AAPRICE 生产环境的 API Key。
3. 准备发件地址：`AAPRICE <alerts@prices.stbf.online>`。

## 2. 配置 Supabase Function Secrets

在 Supabase Dashboard 的 Edge Functions Secrets 中添加：

```text
PRICE_ALERT_CRON_SECRET=<至少 32 位随机值>
RESEND_API_KEY=<Resend API Key>
PRICE_ALERT_FROM_EMAIL=<已验证的发件地址>
PRICE_ALERT_APP_URL=<生产站点根路径，结尾带 />
```

不要给这些变量添加 `PUBLIC_` 前缀。

## 3. 配置 GitHub Actions Secrets

添加：

```text
SUPABASE_ACCESS_TOKEN=<Supabase Personal Access Token>
PRICE_ALERT_CRON_SECRET=<与 Supabase 中完全相同>
```

Project Ref 与函数 URL 已固定在工作流中，它们不是密钥，无需重复配置。

## 4. 部署与验证

1. 手动运行 `Deploy Supabase functions` 工作流。
   - 工作流会在缺少部署 Secret 时给出明确错误。
   - 部署后会自动发起未认证请求；返回 `401` 才表示函数已上线且 `PRICE_ALERT_CRON_SECRET` 已生效。
2. 在个人中心给一个收藏商品设置高于当前最低价的测试目标价。
3. 手动运行 `Send price alerts` 工作流。
4. 确认工作流返回 `sent: 1`，并收到邮件。
5. 在管理后台的“业务 → 降价提醒发送健康度”确认成功率与失败记录。
6. 将测试提醒停用，避免重复测试干扰生产指标。

若发送失败，先看管理后台的最近错误；队列会自动退避重试，最多尝试 5 次。

发送前会重新核对提醒仍启用、排队价格仍满足当前目标价，以及邮箱已确认。停用可阻止尚未领取的待发邮件；已进入发送流程的邮件可能仍会送达。

若函数地址返回 `404 Requested function was not found`，说明函数还没有部署，而不是邮件供应商报错。先完成第 2、3 节，再重新运行部署工作流。

## 当前生产状态

- 2026-10-24：核查发现队列 RPC 对匿名及普通登录角色存在显式 EXECUTE 授权，已撤回，仅保留 `service_role`；最近行为日志 RPC 同时补齐管理员校验。未通过这些接口读取真实收件人数据；是否曾被他人访问，不能仅凭当前配置或发送工作流记录判断。
- 2026-10-24：生产 `postgres` 在 public schema 的函数默认权限会显式授权匿名和登录角色，导致旧迁移仅撤回 PUBLIC 时仍留下访问权。已取消该默认客户端授权及全局 PUBLIC 默认执行权限；后续客户端 RPC 必须显式 grant。只读审计新增匿名管理 RPC、客户端后台 RPC 与迁移默认授权三项检查。
- 2026-10-24：最近一次已完成的调度记录为成功，返回 `claimed: 0, sent: 0, failed: 0`；库内累计 2 条成功投递和 2 条失败历史记录。这证明近期调度能运行，不代替新邮件送达测试。本次未发送额外邮件。
- 2026-10-24：事务回归验证 service_role 可领取合格邮件；停用、降低目标价和未确认邮箱的邮件不会被领取，处理租约不会重复领取；匿名 HTTP 调用后台接口返回 401，普通登录角色无法读取管理日志，管理员仍可读取。所有测试账户、提醒、队列变化均回滚。

- 2026-09-01：Resend 域名、DKIM 与 SPF 验证通过。
- 2026-09-01：`send-price-alerts` 部署成功，未授权请求正确返回 `401`。
- 2026-09-01：真实测试邮件由 `alerts@prices.stbf.online` 发出，Resend 状态为 `Delivered`；测试提醒已停用。
- 2026-09-01：生产库保留 1 条成功投递记录；域名验证前的 2 条失败测试记录已达到 5 次重试上限，不会继续发送。
- 2026-10-01 前：轮换 Supabase Access Token，并同步更新 GitHub Secret `SUPABASE_ACCESS_TOKEN`。

回归检查（需要管理数据库连接，测试在事务末尾回滚；不调用邮件供应商）：

```sh
psql "$AAPRICE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/checks/price_alert_queue.sql
psql "$AAPRICE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/checks/security_audit.sql
```
