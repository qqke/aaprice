# 生产安全响应头

当前 `prices.stbf.online` 是 DNS-only CNAME，直接指向 GitHub Pages。页面已包含可由浏览器执行的 CSP 基线；HSTS、`X-Content-Type-Options`、`frame-ancestors` 和 `Permissions-Policy` 必须在反向代理层作为 HTTP 响应头下发。

Cloudflare 上线步骤（不涉及 Turnstile）：

1. 将 `prices` CNAME 保持指向 `qqke.github.io`，开启代理。
2. 创建 Response Header Transform Rule，仅匹配主机名 `prices.stbf.online`。
3. 设置：
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `X-Content-Type-Options: nosniff`
   - `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`
   - `Content-Security-Policy: frame-ancestors 'none'`
4. 确认 SSL/TLS 模式为 Full，并验证首页、登录和 Supabase 请求后再启用 HSTS preload。

验证：`curl -I https://prices.stbf.online/`
