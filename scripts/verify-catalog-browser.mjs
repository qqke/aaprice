import assert from "node:assert/strict"
import { createServer } from "node:http"
import { access, readFile, mkdir } from "node:fs/promises"
import { resolve, extname, sep } from "node:path"
import { chromium } from "playwright-core"

// Run after npm run build. All API traffic is intercepted; no real user data or events.
const root = resolve("dist")
await access(resolve(root, "index.html"))
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml" }
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  const file = resolve(root, "." + path + (path.endsWith("/") ? "index.html" : ""))
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
  try { res.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream"); res.end(await readFile(file)) }
  catch { res.writeHead(404).end() }
})
await new Promise(r => server.listen(0, "127.0.0.1", r))
const origin = `http://127.0.0.1:${server.address().port}`
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean)
let executablePath
for (const path of candidates) { try { await access(path); executablePath = path; break } catch {} }
if (!executablePath) { server.close(); throw new Error("Chrome not found; set CHROME_PATH") }
const browser = await chromium.launch({ executablePath, headless: true })
try {
  const page = await browser.newPage({ locale: "zh-CN", reducedMotion: "reduce" })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  const product = (id, name = id) => ({ id, name, brand: "テスト", pack: "100mL", category: "化粧水", image_url: "/lowprice-logo.png" })
  const products = Array.from({ length: 30 }, (_, i) => product(`p${i}`, `商品 ${i}`))
  products[0].image_url = null
  products[1].image_url = "/missing-fixture-product.png"
  let nextPage, failPreview = false, emptyPreview = false
  let commercialEnabled = false
  let accountFixtures = false
  const fixtureUserId = "00000000-0000-0000-0000-000000000001"
  const fixtureLists = {
    user_price_logs: Array.from({ length: 123 }, (_, i) => ({ id: `log-${i}`, product_id: "needle", price_yen: 100, created_at: "2026-10-24T00:00:00Z" })),
    credit_ledger: Array.from({ length: 137 }, (_, i) => ({ id: `credit-${i}`, amount: 1, reason: "隔离测试", created_at: "2026-10-24T00:00:00Z" })),
    favorites: Array.from({ length: 205 }, (_, i) => ({ id: `favorite-${i}`, entity_type: "store", entity_id: `store-${i}`, created_at: "2026-10-24T00:00:00Z" })),
    product_submissions: Array.from({ length: 111 }, (_, i) => ({ id: `submission-${i}`, name: `隔离商品 ${i}`, barcode: "4511413405048", review_status: "pending", created_at: "2026-10-24T00:00:00Z" })),
  }
  const exposures = []
  await page.route("**/rest/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), body = request.postDataJSON()
    const table = url.pathname.split("/").at(-1)
    if (accountFixtures && fixtureLists[table]) {
      assert.equal(url.searchParams.get("user_id"), `eq.${fixtureUserId}`)
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc")
      const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit"))
      return route.fulfill({ json: fixtureLists[table].slice(offset, offset + limit) })
    }
    if (accountFixtures && table === "profiles") return route.fulfill({ json: [{ id: fixtureUserId, email: "review@example.com", role: "user", full_name: "隔离测试账户" }] })
    if (accountFixtures && table === "fetch_favorite_price_changes") return route.fulfill({ json: { days: 7, items: [] } })
    if (accountFixtures && table === "fetch_my_price_alerts") return route.fulfill({ json: [{ product_id: "needle", target_price_yen: 300, is_active: true }] })
    if (url.pathname.endsWith("/fetch_credit_summary")) return route.fulfill({ json: { balance: 0, daily_free_price_references: 5, references_today: 0 } })
    if (url.pathname.endsWith("/fetch_product_prices")) return route.fulfill({ json: [
      { store_id: "unknown", price_yen: 100, distance_km: null, collected_at: new Date().toISOString(), stores: { name: "未知坐标店", address: "东京某街道", lat: null, lng: null } },
      { store_id: "physical", price_yen: 200, distance_km: 1, collected_at: new Date().toISOString(), stores: { name: "附近实体店", lat: 35.71, lng: 139.7 } },
      { store_id: "sundrug-00000", price_yen: 90, distance_km: 0, collected_at: new Date().toISOString(), stores: { name: "官方在线商店", lat: 35.7, lng: 139.7 } },
    ] })
    if (url.pathname.endsWith("/record_telemetry_event") && body.payload.event_name === "commercial_offer_seen") {
      exposures.push(body.payload.properties)
      return route.fulfill({ json: null })
    }
    if (url.pathname.endsWith("/fetch_commercial_offers")) return route.fulfill({ json: commercialEnabled ? body.payload.product_ids.map(id => ({ id: `offer-${id}`, product_id: id, partner: "rakuten" })) : [] })
    if (url.pathname.endsWith("/fetch_public_ranked_products")) {
      if (body.payload.offset) { await new Promise(r => { nextPage = r }); return route.fulfill({ json: [product("obsolete-page")] }) }
      return route.fulfill({ json: products })
    }
    if (url.pathname.endsWith("/products")) return route.fulfill({ json: [product("needle", "搜索匹配商品")] })
    if (url.pathname.includes("price_preview")) {
      if (failPreview) return route.fulfill({ status: 503, json: { message: "preview unavailable" } })
      return route.fulfill({ json: emptyPreview ? [] : (body.payload.product_ids || ["needle"]).map((id, i) => ({ product_id: id, min_price_yen: i === 0 ? 5500 : 292, store_count: 2, latest_collected_at: new Date().toISOString() })) })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto(origin)
  await page.locator("#catalog article").nth(29).waitFor()
  await page.getByRole("img", { name: "商品 0：暂无商品图", exact: true }).waitFor()
  await page.getByRole("img", { name: "商品 1：暂无商品图", exact: true }).waitFor()
  await page.getByRole("button", { name: /筛选与排序/ }).click()
  await page.getByLabel("结果排序", { exact: true }).click()
  await page.getByRole("option", { name: "最低价优先" }).click()
  assert.notEqual(await page.locator("#catalog article h3").first().innerText(), "商品 0")
  await page.getByRole("slider", { name: "最高预算" }).press("Home")
  await page.getByRole("heading", { name: "商品 0", exact: true }).waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "重置", exact: true }).click()
  const pagingRequest = page.waitForRequest(req => req.url().includes("fetch_public_ranked_products") && req.postDataJSON()?.payload?.offset > 0)
  await page.getByRole("button", { name: "加载更多商品", exact: true }).click()
  await pagingRequest
  await page.getByRole("searchbox", { name: "搜索商品" }).fill("needle")
  await page.getByRole("heading", { name: "搜索匹配商品", exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get("q"), "needle")
  const oldResponse = page.waitForResponse(res => res.url().includes("fetch_public_ranked_products"))
  nextPage()
  await oldResponse
  await page.waitForTimeout(100)
  assert.equal(await page.locator("#catalog article").count(), 1)
  assert.equal(await page.getByRole("heading", { name: "obsolete-page" }).count(), 0)
  await page.reload()
  await page.getByRole("heading", { name: "搜索匹配商品", exact: true }).waitFor()
  assert.equal(await page.getByRole("searchbox", { name: "搜索商品" }).inputValue(), "needle")
  failPreview = true
  await page.goto(origin + "/product/?id=needle")
  await page.getByRole("alert").filter({ hasText: "价格预览暂时无法加载" }).waitFor()
  failPreview = false
  await page.getByRole("button", { name: "重试价格预览" }).click()
  await page.getByText("匿名价格预览", { exact: true }).waitFor()
  emptyPreview = true
  await page.reload()
  await page.getByRole("heading", { name: "暂无近期价格预览" }).waitFor()
  assert.match(await page.locator("main").innerText(), /查询也可能暂无结果/)
  emptyPreview = false
  commercialEnabled = true
  await page.setViewportSize({ width: 375, height: 400 })
  await page.goto(origin + "/product/?id=needle")
  await page.getByText("匿名价格预览", { exact: true }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(exposures.length, 0, "loaded offer below viewport must not count")
  await page.getByRole("button", { name: "合作购买", exact: true }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  assert.equal(exposures.length, 1)
  assert.deepEqual(exposures[0], { offer_id: "offer-needle", product_id: "needle", source: "product", measurement: "viewport_v1" })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole("button", { name: "合作购买", exact: true }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  assert.equal(exposures.length, 1, "scrolling back must not recount the same mounted offer")
  await page.goto(origin)
  await page.evaluate(() => localStorage.setItem("aprice:compare-selection", JSON.stringify(["p0", "p1"])))
  await page.reload()
  await page.locator("#catalog article").nth(29).waitFor()
  await page.getByRole("button", { name: "查看清单" }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(exposures.length, 1, "offers loaded for a closed comparison must not count")
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.getByRole("button", { name: "查看清单" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "合作购买", exact: true }).first().waitFor()
  await page.waitForTimeout(200)
  assert.equal(exposures.filter(item => item.source === "compare").length, 2, "only visible desktop buttons count, not hidden mobile copies")
  await page.getByRole("button", { name: "关闭", exact: true }).click()
  await page.evaluate(() => localStorage.clear())
  commercialEnabled = false
  let signupRedirect, resetRedirect, autoConfirm = false
  await page.route("**/auth/v1/**", route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/signup")) {
      signupRedirect = url.searchParams.get("redirect_to")
      if (autoConfirm) {
        const payload = Buffer.from(JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")
        return route.fulfill({ json: { access_token: `e30.${payload}.cWE`, refresh_token: "isolated-fixture", expires_in: 3600, token_type: "bearer", user: { id: "00000000-0000-0000-0000-000000000001", identities: [{ id: "qa" }] } } })
      }
      return route.fulfill({ json: { id: "qa", email: "review@example.com", identities: [{ id: "qa" }] } })
    }
    if (url.pathname.endsWith("/recover")) resetRedirect = url.searchParams.get("redirect_to")
    return route.fulfill({ json: {} })
  })
  const returnTo = "/product/?id=needle"
  await page.goto(origin + "/login/?mode=register&redirect=" + encodeURIComponent(returnTo))
  await page.getByLabel("邮箱", { exact: true }).fill("review@example.com")
  await page.getByLabel("密码", { exact: true }).fill("isolated-test-password")
  await page.getByLabel("确认密码", { exact: true }).fill("isolated-test-password")
  await page.getByRole("button", { name: "注册", exact: true }).click()
  await page.getByText("注册邮件已发送，请确认邮箱后继续。", { exact: true }).waitFor()
  assert.equal(new URL(signupRedirect).searchParams.get("redirect"), returnTo)
  await page.goto(origin + "/login/?mode=resetRequest&redirect=" + encodeURIComponent(returnTo))
  await page.getByLabel("邮箱", { exact: true }).fill("review@example.com")
  await page.getByRole("button", { name: "发送重置邮件", exact: true }).click()
  await page.getByText("密码重置邮件已发送。", { exact: true }).waitFor()
  assert.equal(new URL(resetRedirect).searchParams.get("mode"), "reset")
  assert.equal(new URL(resetRedirect).searchParams.get("redirect"), returnTo)
  await page.goto(origin + "/login/#error=access_denied&error_code=otp_expired")
  await page.getByRole("alert").filter({ hasText: "验证链接无效或已过期" }).waitFor()
  autoConfirm = true
  await page.goto(origin + "/login/?mode=register&redirect=" + encodeURIComponent(returnTo))
  await page.getByLabel("邮箱", { exact: true }).fill("review@example.com")
  await page.getByLabel("密码", { exact: true }).fill("isolated-test-password")
  await page.getByLabel("确认密码", { exact: true }).fill("isolated-test-password")
  await page.getByRole("button", { name: "注册", exact: true }).click()
  await page.waitForURL(origin + returnTo)
  await page.evaluate(() => sessionStorage.setItem("aprice:location", JSON.stringify({ lat: 35.7, lng: 139.7, savedAt: Date.now() })))
  await page.reload()
  await page.getByRole("button", { name: "免费查询报价", exact: true }).first().click()
  await page.getByRole("heading", { name: "未知坐标店", exact: true }).waitFor()
  const priceSection = page.locator("#store-prices")
  const unknownStore = priceSection.locator(".divide-y > div").filter({ has: page.getByRole("heading", { name: "未知坐标店", exact: true }) })
  assert.doesNotMatch(await unknownStore.innerText(), /0m|最近|NaN/)
  const mapHref = await page.getByRole("link", { name: "在地图查看 未知坐标店", exact: true }).getAttribute("href")
  assert.match(decodeURIComponent(mapHref), /未知坐标店.*东京某街道/)
  assert.equal(await priceSection.getByText("最近", { exact: true }).count(), 1)
  const closestStore = priceSection.locator(".divide-y > div").filter({ has: page.getByRole("heading", { name: "附近实体店", exact: true }) })
  assert.equal(await closestStore.getByText("最近", { exact: true }).count(), 1)
  accountFixtures = true
  await page.goto(origin + "/me/")
  await page.getByRole("button", { name: "导出数据", exact: true }).waitFor()
  const downloadReady = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出数据", exact: true }).click()
  const download = await downloadReady
  const exported = JSON.parse(await readFile(await download.path(), "utf8"))
  assert.equal(exported.profile.id, fixtureUserId)
  for (const [table, key] of [["user_price_logs", "price_logs"], ["credit_ledger", "credit_ledger"], ["favorites", "favorites"], ["product_submissions", "product_submissions"]]) {
    assert.deepEqual(exported[key].map(item => item.id), fixtureLists[table].map(item => item.id), `export must include every ${table} page`)
  }
  assert.equal(exported.price_alerts.length, 1)
  assert.ok(Number.isFinite(Date.parse(exported.exported_at)))
  accountFixtures = false
  await page.evaluate(() => localStorage.clear())
  await mkdir("artifacts/commercial-audit", { recursive: true })
  for (const width of [375, 768, 1440]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 950 })
      await page.addInitScript(value => localStorage.setItem("theme", value), theme)
      await page.goto(origin)
      await page.locator("#catalog article").nth(29).waitFor()
      await page.getByRole("button", { name: "更新当前位置", exact: true }).waitFor()
      await page.waitForTimeout(500)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${theme} overflow`)
      await page.screenshot({ path: `artifacts/commercial-audit/${width}-${theme}-home.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log("Browser checks passed: missing/broken product image placeholders, public price filtering/sorting, stale pagination, search links/reload, preview retry/empty state, visible commercial exposure, closed comparison/hidden duplicates excluded, isolated signup/recovery callbacks, expired-link feedback, unknown distance/address maps, nearest physical store, full account JSON export across four paginated datasets, cached-location hydration, 6 responsive/theme views.")
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)) }
