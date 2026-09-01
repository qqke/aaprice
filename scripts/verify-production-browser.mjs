import { access } from "node:fs/promises"
import { chromium } from "playwright-core"

const siteUrl = process.argv[2]
if (!siteUrl?.startsWith("https://")) throw new Error("Usage: node scripts/verify-production-browser.mjs https://example.com/")

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean)
let executablePath
for (const candidate of candidates) {
  try { await access(candidate); executablePath = candidate; break } catch {}
}
if (!executablePath) throw new Error("Chrome executable not found; set CHROME_PATH")

const browser = await chromium.launch({ executablePath, headless: true })
try {
  const page = await browser.newPage({ locale: "zh-CN" })
  await page.goto(siteUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { name: /款可比较商品/ }).waitFor({ timeout: 20_000 })
  await page.getByText(/\d+ 源/, { exact: true }).first().waitFor({ timeout: 20_000 })

  await page.getByRole("button", { name: "登录", exact: true }).click()
  await page.getByRole("link", { name: "注册账号", exact: true }).waitFor()
  await page.getByRole("link", { name: "忘记密码", exact: true }).waitFor()
  const registerUrl = await page.getByRole("link", { name: "注册账号", exact: true }).getAttribute("href")
  if (!registerUrl?.includes("mode=register") || !registerUrl.includes("redirect=")) throw new Error("registration link lost its mode or return path")

  await page.goto(new URL(registerUrl, siteUrl).href, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { name: "创建账号", exact: true }).waitFor({ timeout: 20_000 })
  await page.getByRole("link", { name: "隐私与数据说明", exact: true }).waitFor()

  await page.goto(siteUrl, { waitUntil: "domcontentloaded" })
  const productHref = await page.locator('a[href*="/product/?id="]').first().getAttribute("href")
  if (!productHref) throw new Error("catalog did not expose a product detail link")
  await page.goto(new URL(productHref, siteUrl).href, { waitUntil: "domcontentloaded" })
  await page.getByText("匿名价格预览", { exact: true }).waitFor({ timeout: 20_000 })
  const body = await page.locator("body").innerText()
  const priceIndex = body.indexOf("匿名价格预览")
  const commercialIndex = body.indexOf("合作链接")
  if (commercialIndex !== -1 && commercialIndex < priceIndex) throw new Error("commercial CTA appears before the price preview")

  console.log(`Production browser check passed: ${new URL(siteUrl).origin}`)
} finally {
  await browser.close()
}
