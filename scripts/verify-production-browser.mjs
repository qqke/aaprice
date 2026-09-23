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
  // Verify anonymous catalog value without coupling the smoke test to heading copy.
  const product = page.locator("#catalog article").first()
  const productHref = await product.isVisible({ timeout: 20_000 }).then(async (visible) => visible ? product.getByRole("heading").getByRole("link").getAttribute("href") : null).catch(() => null)

  await page.getByRole("button", { name: "登录", exact: true }).waitFor({ timeout: 20_000 })

  if (productHref) {
    await page.goto(new URL(productHref, siteUrl).href, { waitUntil: "domcontentloaded" })
    await page.getByText("匿名价格预览", { exact: true }).waitFor({ timeout: 20_000 })
    const body = await page.locator("body").innerText()
    const priceIndex = body.indexOf("匿名价格预览")
    const commercialIndex = body.indexOf("合作链接")
    if (commercialIndex !== -1 && commercialIndex < priceIndex) throw new Error("commercial CTA appears before the price preview")
  }

  console.log(`Production browser check passed: ${new URL(siteUrl).origin}`)
} finally {
  await browser.close()
}
