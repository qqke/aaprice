# AAPRICE

基于 Astro、React、shadcn/ui、Motion 和 Supabase 的日本药妆商品比较应用。

## 本地开发

```sh
npm ci
npm run dev
```

## 生产构建

```sh
npm test
npm run build
```

构建产物位于 `dist/`，可发布到静态托管服务。

## 后台配置

复制 `.env.example` 为 `.env`，填入 AAPRICE 使用的公开配置：

```sh
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_ANON_KEY=...
PUBLIC_TURNSTILE_SITE_KEY=...
PUBLIC_DISABLE_TURNSTILE=0
```

首次接入新的 Supabase 项目时，按文件名时间顺序应用 `supabase/migrations/` 下的迁移。配置后，商品目录、模糊搜索、JAN 扫码和门店价格会读取同一套后台；匿名用户仅能读取近期普通店头价的聚合预览，具体门店价格仍只在登录用户主动查询时调用。

所有 `PUBLIC_` 变量都会进入浏览器构建产物。这里只能使用 Supabase anon key，禁止填写 service role key 或其他服务端密钥。生产环境应启用 Turnstile；`PUBLIC_DISABLE_TURNSTILE=1` 仅用于本地测试。

## 降价邮件提醒

执行 `20260831183000_price_alert_delivery_retries.sql` 后，部署 `send-price-alerts` Edge Function，并在 Supabase Function Secrets 配置：

```text
PRICE_ALERT_CRON_SECRET=随机长密钥
RESEND_API_KEY=Resend API Key
PRICE_ALERT_FROM_EMAIL=AAPRICE <alerts@你的已验证域名>
PRICE_ALERT_APP_URL=https://你的站点根路径/
```

再在 GitHub Actions Secrets 配置同一个 `PRICE_ALERT_CRON_SECRET`，以及完整的 `PRICE_ALERT_FUNCTION_URL`（`https://项目引用.supabase.co/functions/v1/send-price-alerts`）。定时工作流每 15 分钟触发一次；数据库会原子领取任务，失败后退避重试，最多尝试 5 次。未配置时定时任务会安全跳过。

如需从 GitHub 部署函数，再配置 `SUPABASE_ACCESS_TOKEN` 和 `SUPABASE_PROJECT_ID`，然后手动运行 `Deploy Supabase functions` 工作流。所有服务端密钥都不得使用 `PUBLIC_` 前缀。

## Sandrug 商品与价格同步

本地安装 `psql` 后，可用服务端数据库连接刷新线上目录：

```sh
AAPRICE_DB_URL=postgresql://... npm run sundrug:sync
```

脚本使用 Sandrug 公开目录，只接受有效 JAN 和正整数日元价格。它会先完成全量抓取及数量校验，再以单一事务更新商品、追加当前可售价格并生成符合条件的降价提醒；同商品同价格在 20 小时内重复执行不会再次写入。公开源最多返回 25,000 件商品，已有但未出现在本轮源数据中的历史商品不会被删除。

GitHub Actions 每周运行一次 `.github/workflows/sync-sundrug.yml`。在仓库 Actions Secrets 配置仅供服务端使用的 `SUPABASE_DB_URL`；未配置时任务会安全跳过。可用 `npm run sundrug:sync -- --dry-run` 只验证上游数据，不连接数据库。
