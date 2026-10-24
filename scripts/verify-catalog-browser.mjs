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
  let nextPage, failPreview = false, emptyPreview = false
  await page.route("**/rest/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), body = request.postDataJSON()
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
  await mkdir("artifacts/commercial-audit", { recursive: true })
  for (const width of [375, 768, 1440]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 950 })
      await page.addInitScript(value => localStorage.setItem("theme", value), theme)
      await page.goto(origin)
      await page.locator("#catalog article").nth(29).waitFor()
      await page.waitForTimeout(500)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${theme} overflow`)
      await page.screenshot({ path: `artifacts/commercial-audit/${width}-${theme}-home.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log("Catalog browser checks passed: public price filtering/sorting, stale pagination, search links/reload, preview retry/empty state, 6 responsive/theme views.")
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)) }
