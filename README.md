# AAPRICE

基于 Astro、React、shadcn/ui 和 Motion 的日本药妆商品比较应用原型。

```sh
npm install
npm run dev
```

```sh
npm test
npm run build
```

复制 `.env.example` 为 `.env`，填入原 `aprice` 使用的同一组公开配置：

```sh
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_ANON_KEY=...
PUBLIC_TURNSTILE_SITE_KEY=...
PUBLIC_DISABLE_TURNSTILE=0
```

配置后，商品目录、模糊搜索、JAN 扫码和门店价格会读取原 Supabase。目录查询公开可用；门店价格沿用原后台登录与额度规则，只在用户主动查询时调用。
