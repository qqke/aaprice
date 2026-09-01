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

若函数地址返回 `404 Requested function was not found`，说明函数还没有部署，而不是邮件供应商报错。先完成第 2、3 节，再重新运行部署工作流。

## 当前生产状态

- 2026-09-01：Resend 域名、DKIM 与 SPF 验证通过。
- 2026-09-01：`send-price-alerts` 部署成功，未授权请求正确返回 `401`。
- 2026-09-01：真实测试邮件由 `alerts@prices.stbf.online` 发出，Resend 状态为 `Delivered`；测试提醒已停用。
- 2026-10-01 前：轮换 Supabase Access Token，并同步更新 GitHub Secret `SUPABASE_ACCESS_TOKEN`。
