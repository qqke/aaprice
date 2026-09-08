# AAPRICE

基于 Astro、React、Radix UI、Motion 和 Supabase 的日本药妆商品比较应用。

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

GitHub Actions 每周运行一次 `.github/workflows/sync-sundrug.yml`。在仓库 Settings → Secrets and variables → Actions 配置仅供服务端使用的 `SUPABASE_DB_URL`；未配置时正式同步会明确失败，不会显示成功或跳过。连接串从 Supabase 的 Connect 面板获取，使用支持运行环境网络的 PostgreSQL 连接方式并启用 SSL；不要提交到代码或日志。

手动 Run workflow 默认勾选 `dry_run`，只抓取和校验上游目录，不连接数据库、不写入价格、不触发提醒。确认统计正常并配置密钥后，取消勾选才会正式同步。定时运行始终执行正式同步；正式同步在抓取前验证数据库连接。也可本地运行 `npm run sundrug:sync -- --dry-run`。抓取或最低目录数量校验失败都会返回失败，不能将 dry run 成功视为生产数据已更新。

若 GitHub 运行器连接 `db.<project>.supabase.co` 报 IPv6 `Network is unreachable`，请从 Supabase → Connect → Session pooler 复制 IPv4 连接串（端口 5432），更新同名 Secret。主机和用户名都以面板为准，不要只替换端口；保留 `sslmode=require`，替换密码占位符并对密码中的 URI 特殊字符进行编码。此问题无需修改数据库结构或关闭 SSL。参考：[Supabase 连接指南](https://supabase.com/docs/guides/database/connecting-to-postgres)。
