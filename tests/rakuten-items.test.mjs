import assert from "node:assert/strict"
import test from "node:test"
import { decodeRakutenHtml, isPurchasableRakutenItem } from "../scripts/lib/rakuten-items.mjs"

test("affiliate candidates require exact item metadata, purchasable state and standard condition", () => {
  const barcode = "4514254231555"
  const item = { articleNumber: { value: barcode }, title: "化粧水 レフィル 110ml", purchaseInfo: { purchaseBySellType: { purchaseCondition: "enabled" } } }
  const html = (data) => `<script type="application/json" id="item-page-app-data">${JSON.stringify({ api: { data: { itemInfoSku: data } } })}</script>`
  assert.equal(isPurchasableRakutenItem(html(item), barcode), true)
  assert.equal(isPurchasableRakutenItem(html(item), "4514254231470"), false)
  assert.equal(isPurchasableRakutenItem(html({ ...item, title: "" }), barcode), false)
  for (const title of ["【訳あり】化粧水", "中古", "アウトレット"]) assert.equal(isPurchasableRakutenItem(html({ ...item, title }), barcode), false)
  assert.equal(isPurchasableRakutenItem(html({ ...item, purchaseInfo: { purchaseBySellType: { purchaseCondition: "sold-out" } } }), barcode), false)
  assert.equal(isPurchasableRakutenItem(html({ ...item, purchaseInfo: { ...item.purchaseInfo, newPurchaseSku: { stockCondition: "sold-out" } } }), barcode), false)
  assert.equal(isPurchasableRakutenItem(`<title>${barcode}</title>`, barcode), false)
  assert.equal(isPurchasableRakutenItem('<script id="item-page-app-data">not json</script>', barcode), false)
})

test("retailer pages honor EUC-JP and UTF-8 encoding instead of corrupting condition labels", () => {
  assert.equal(decodeRakutenHtml(new Uint8Array([0xa5, 0xc6, 0xa5, 0xb9, 0xa5, 0xc8]), "text/html; charset=EUC-JP"), "テスト")
  const text = '<meta charset="utf-8">訳あり'
  assert.equal(decodeRakutenHtml(new TextEncoder().encode(text)), text)
})

test("generator skips a sold-out exact URL and validates the next retailer without affiliate clicks", async () => {
  const barcode = "4514254231555"
  const oldArgs = process.argv, oldFetch = globalThis.fetch, oldLog = console.log
  const calls = [], output = []
  try {
    process.argv = [process.execPath, "generate-rakuten-offers.mjs", "--validate", barcode]
    console.log = value => output.push(value)
    globalThis.fetch = async value => {
      const url = String(value)
      calls.push(url)
      if (url.startsWith("https://search.rakuten.co.jp/")) return new Response(`https://item.rakuten.co.jp/sold/${barcode}/ https://item.rakuten.co.jp/available/${barcode}/`)
      assert.ok(url.startsWith("https://item.rakuten.co.jp/"), "validation must not follow affiliate tracking URLs")
      const item = { articleNumber: { value: barcode }, title: "化粧水 レフィル 110ml", purchaseInfo: { purchaseBySellType: { purchaseCondition: url.includes("/sold/") ? "sold-out" : "enabled" } } }
      return new Response(`<script id="item-page-app-data">${JSON.stringify({ api: { data: { itemInfoSku: item } } })}</script>`, { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    await import("../scripts/generate-rakuten-offers.mjs")
    const results = JSON.parse(output[0])
    assert.equal(results[0].item_url, `https://item.rakuten.co.jp/available/${barcode}/`)
    assert.equal(results[0].item_verified, true)
    assert.equal(calls.length, 3)
  } finally {
    process.argv = oldArgs
    globalThis.fetch = oldFetch
    console.log = oldLog
  }
})
