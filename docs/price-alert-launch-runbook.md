# 降价提醒上线清单

## 1. 准备发件服务

1. 在 Resend 添加并验证发件域名。
2. 创建仅用于 AAPRICE 生产环境的 API Key。
3. 准备发件地址，例如 `AAPRICE <alerts@example.com>`。

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
SUPABASE_PROJECT_ID=<Supabase Project Ref>
PRICE_ALERT_CRON_SECRET=<与 Supabase 中完全相同>
PRICE_ALERT_FUNCTION_URL=https://<Project Ref>.supabase.co/functions/v1/send-price-alerts
```

## 4. 部署与验证

1. 手动运行 `Deploy Supabase functions` 工作流。
2. 在个人中心给一个收藏商品设置高于当前最低价的测试目标价。
3. 手动运行 `Send price alerts` 工作流。
4. 确认工作流返回 `sent: 1`，并收到邮件。
5. 在管理后台的“业务 → 降价提醒发送健康度”确认成功率与失败记录。
6. 将测试提醒停用，避免重复测试干扰生产指标。

若发送失败，先看管理后台的最近错误；队列会自动退避重试，最多尝试 5 次。
