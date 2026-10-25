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

## 其他药妆店商品与实体门店采集

只扩充商品目录、不更新已有商品时，使用独立采集和导入入口（本地 Node 支持 `--env-file=.env`，服务端连接变量为 `AAPRICE_DB_URL`）：

```sh
node scripts/crawl-kao-products.mjs
node scripts/crawl-shiseido-products.mjs --resume
node scripts/crawl-matsukiyo-products.mjs
node --env-file=.env scripts/crawl-sundrug-products.mjs
node --env-file=.env scripts/crawl-sundrug-collections.mjs --resume
node scripts/crawl-shopify-products.mjs --resume
node scripts/import-new-products.mjs artifacts/products-2026-10-22/kao.json
node --env-file=.env scripts/import-new-products.mjs artifacts/products-2026-10-22/kao.json --apply
```

各来源可并行运行；单站并发有界。采集结果和覆盖报告保存在 `artifacts/products-2026-10-22/`（不提交原始数据），导入命令可接多个商品 JSON 文件。先检查对应 `*-report.json` 的失败和覆盖差异；源站限流或过期链接会明确记入报告，不代表完整覆盖。Sundrug 使用 sitemap 补充普通接口的分页上限；松本清按官方分类树拆分搜索窗口；Shopify 目录同时覆盖スギ和クオール。

导入默认只校验并生成 SQL，添加 `--apply` 才写库。它校验 GTIN 校验位与官方来源域名，以商品 ID 和补零至 14 位后的 GTIN 身份跳过已有项（UPC 与补零 EAN 视为同一商品，保留源条码），冲突时忽略；事务提交前逐条校验旧商品指纹。此入口只插入 `products`，不写价格、门店或提醒，不更新旧商品时间戳。报告列出新增、跳过、排除和来源数量；重复执行不会重复插入。官方目录包含的停产商品只作为商品身份保留，不声明库存或当前价格。原有 `sundrug:sync` 仍用于需要更新商品和价格的同步任务。

补采第一轮公开分类之外的商品、失败详情及色号/容量变体：

```sh
node --env-file=.env scripts/crawl-matsukiyo-extra.mjs
node --env-file=.env scripts/crawl-sundrug-extra.mjs
node scripts/retry-qols-products.mjs
node --env-file=.env scripts/crawl-shiseido-variants.mjs --resume
```

结果与覆盖报告写入 `artifacts/products-round2-2026-10-22/`，不覆盖第一轮证据。继续使用 `import-new-products.mjs` 导入这些 JSON；采集进程不直接写库。覆盖统计区分已请求页面、验证通过的 JAN 和实际新增，官方标示总数或套餐内部编号不作为新增数量。

Sundrug 优先使用分类和详情资料，剩余商品可用官方 sitemap 中相互匹配的合法 JAN、商品名及图片补充身份；未证实的品牌、容量和类别留空，报告单列 `sitemapAdded`。松本清使用官网公开价格区间递归拆分搜索窗口；资生堂只接受官方变体接口明确返回且通过校验位检查的 JAN。

继续补查 Sundrug 内部编码链接，并扩展 Lion 与麒麟堂官方商品目录：

```sh
node scripts/crawl-sundrug-unresolved.mjs
node scripts/crawl-lion-products.mjs --resume
node --env-file=.env scripts/crawl-kirindo-products.mjs
node --env-file=.env scripts/crawl-kirindo-categories.mjs
```

本批结果位于 `artifacts/products-round3-2026-10-22/`。Lion 只接受官方接口中子规格明确提供的 JAN 和完整名称，父商品图仅作代表图；麒麟堂只对数据库未知候选读取详情，以 Product JSON-LD 的 GTIN 验证身份，不把商品链接中的数字直接当作条码。Sundrug 的套装后缀、整箱内部编码不剥除或猜测成 JAN。仍使用上述只插入导入器落库，公开目录覆盖数和实际新增数分别记录。

麒麟堂总搜索列表若返回 406，分类补采按公开一级分类分页，并逐个核对唯一链接数与分类总数；它复用前一步列表和详情缓存。分类完成与全站覆盖分开报告，全站完整性需要合并列表链接数与总搜索标示数相符。

进一步扩展商品目录（结果写入 `artifacts/products-round4-2026-10-22/`）：

```sh
node --env-file=.env scripts/crawl-welcia-products.mjs
node --env-file=.env scripts/crawl-unicharm-products.mjs
node --env-file=.env scripts/crawl-earth-products.mjs
node --env-file=.env scripts/crawl-tsuruha-products.mjs
node --env-file=.env scripts/crawl-tomods-products.mjs
```

Welcia 核对公开商品列表与 sitemap；Unicharm 使用官方子规格 JAN；Earth 要求当前商品主购买链接与主图条码一致。鹤羽按 sitemap SKU 批量读取公开接口的 `tgmd_jan_code`，校验 SKU、URL 和分页一致性，内部商品 ID 不作为 JAN。Tomod’s 要求商品卡、购物车链接、图片编码一致，并逐个核对未知商品详情中的商品コード、Product.mpn、名称和图片；列表标示数与可见卡片差异保留在报告。采集与导入仍分开，沿用只插入、等价条码去重和旧商品指纹校验。

继续扩展现有店铺与品牌（默认结果写入 `artifacts/products-round5-2026-10-25/`）：

```sh
node --env-file=.env scripts/crawl-create-products.mjs
node --env-file=.env scripts/crawl-kyorindo-products.mjs
node --env-file=.env scripts/crawl-doramori-products.mjs
node --env-file=.env scripts/crawl-seims-products.mjs
node --env-file=.env scripts/crawl-kai-products.mjs
node --env-file=.env scripts/crawl-elpa-products.mjs
```

Create SD 与杏林堂核对全目录分页及未知商品详情；Doramori 核对当前结构化商品、链接及主图身份。Seims 遵守至少 10 秒的请求间隔，列表候选单独保存在 `seims-list-candidates.json`，只有通过详情核验的商品写入 `seims.json`。貝印使用页面明确标注且与当前商品数据一致的 JAN，商城内部编号不作为条码；ELPA 仅接受直营目录中厂家明确为朝日電器的商品。导入器另排除 GS1 020–029、040–049、200–299 限制流通号，不修改库中已有记录。`complete` 表示相应公开范围的抓取和核验完成，仍须查看被排除的无条码、套装及证据不足商品。各次执行应使用不同 `--out=` 目录保留入库证据，正在采集的结果不可当作全量报告。

全国药妆连锁门店目录扩充：

```sh
node scripts/crawl-national-stores.mjs --out=artifacts/drugstores-national-2026-09-12
```

中断后可加 `--resume` 复用同批缓存（保留原采集时间），只请求缺失页面；新鲜度更新应开启新输出目录。2026-09-13 新增新生堂、アカカベ、ゴダイ目录，完成 Cosmos 补采；本批入库及待坐标记录见 [并行采集结果](docs/drugstore-parallel-results-2026-09-13.md)。Mori、ZAGZAG 和サンキュードラッグ仅有地址或地图中心的记录，不作为精确门店坐标入库。

本次接入官方公开目录并导入门店资料：鹤羽、松本清／Cocokara、杉药局、Cosmos、Create SD、Tomod’s、Satsudora、V・Drug、Seki、Drug Yutaka、Cawachi、Kirindo、药王堂、青木、大国药妆。门店目录和线上价格分开处理；没有官方公开价格入口的连锁不会产生猜测价格。行业协会企业名录仅用于追踪未接入连锁，不作为完整分母。

```sh
npm run drugstores:crawl -- --limit=300 --stores=200 --welcia-stores=3000
```

从鹤羽、Welcia、松本清／Cocokara 的官方公开页面采集价格。默认每个网店最多检查 300 个商品页面；鹤羽集团和松本清／Cocokara 各检查最多 200 个实体门店，Welcia 官方目录最多读取 3,000 条并排除非药妆店、非药局业态。松本清的候选 JAN 优先取自已抓到的商品，以增加相同商品的跨店比较。商品采集是有上限的首批覆盖，不代表全量目录。

输出位于 `artifacts/drugstores-YYYY-MM-DD/`（目录日期为运行开始时的 UTC 日期）：

- `products.json`：商品、原始含税价格、JAN、来源链接、实际采集时间、是否适合比较及复核原因。
- `stores.json`：实体门店名称、地址、坐标和营业时间；不会给实体分店复制网店价。
- `report.json`：覆盖数、跨来源匹配数、复核与失败记录；采集时 `databaseApplied` 为 `false`，经数据库复查后才可标记已导入。
- `review.json`：按来源页面保留全部待复核报价；组合装即使沿用单件 JAN，也不会覆盖合格的单件报价。
- `import.sql`：事务式导入，按 JAN 复用现有商品，只给独立的“オンライン”网店记录写入合格价格。同价 20 小时内去重，超过 7 天的价格不导入；不覆盖现有商品详情、不删除历史数据、不调用提醒发送函数。

只接受通过校验位验证的 JAN-8/JAN-13。缺货、组合装或小数含税价会保留为待复核记录，不擅自取整。价格不含运费、优惠券或积分抵扣。页面内容与来源时间保存在被 Git 忽略的 `cache/`，缓存使用期为 24 小时，遇到 403/429 停止对应来源。

中断后，指定同一输出目录可继续采集；也可完全离线重解析已抓到的页面，保留原时间戳并按来源/JAN 和门店 ID 去重：

```sh
npm run drugstores:crawl -- --out=artifacts/drugstores-2026-09-10
npm run drugstores:crawl -- --offline --out=artifacts/drugstores-2026-09-10
```

离线重解析会包含缓存中的所有已采集记录，因此数量可能超过单次运行上限；它无法恢复未成功下载页面的 HTTP 错误记录。线上导入需要单独提供真实服务端数据库连接（公开 anon key 和带密码占位符的连接串不能写入）。在本地 `.env` 配置 `AAPRICE_DB_URL` 并安装 `psql`，审核报告后执行：

```sh
node --env-file=.env scripts/crawl-drugstores.mjs --import=artifacts/drugstores-2026-09-10/import.sql
```

首次导入前需要应用 `supabase/migrations/20260911143635_allow_online_store_null_coordinates.sql`，允许网店使用空坐标，同时保留实体门店必须有坐标的约束。本次数据库已应用该迁移。

导入复用 Sundrug 的数据库连接方法，通过环境变量将密码传给 `psql`，默认强制 SSL。采集报告不会因后续单独导入而自动改写；导入是否成功以命令退出状态和数据库复查为准。不要把服务端连接串提交到仓库。已完成的首批导入见 [2026-09-11 采集报告](docs/drugstore-expansion-2026-09-11.md)。
