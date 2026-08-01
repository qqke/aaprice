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

首次接入新的 Supabase 项目时，先应用 `supabase/migrations/20260731141000_product_submissions_review.sql`。配置后，商品目录、模糊搜索、JAN 扫码和门店价格会读取同一套后台；门店价格只在用户主动查询时调用。

所有 `PUBLIC_` 变量都会进入浏览器构建产物。这里只能使用 Supabase anon key，禁止填写 service role key 或其他服务端密钥。生产环境应启用 Turnstile；`PUBLIC_DISABLE_TURNSTILE=1` 仅用于本地测试。
