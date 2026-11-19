import assert from "node:assert/strict"
import test from "node:test"
import { barcodeForms, catalogGtin } from "../src/lib/gtin.mjs"
import { deduplicateProducts } from "../scripts/crawl-drugstores.mjs"

test("scanner lookups use all equivalent lengths and keep the packaging indicator", () => {
  const forms = ["96385074", "000096385074", "0000096385074", "00000096385074"]
  for (const form of forms) assert.deepEqual(barcodeForms(form), forms)
  assert.deepEqual(barcodeForms("14912345678907"), ["14912345678907"])
  assert.equal(catalogGtin("123456789"), null)
})

test("a source can change barcode formatting without duplicating a price observation", () => {
  const item = { source: "shop", barcode: "96385074", eligible: true, sourceUrl: "old", collectedAt: "2026-11-18" }
  const newer = { ...item, barcode: "00000096385074", sourceUrl: "new", collectedAt: "2026-11-19" }
  const otherStore = { ...item, source: "another-shop" }
  const { unique } = deduplicateProducts([item, newer, otherStore])
  assert.equal(unique.length, 2)
  assert.ok(unique.includes(newer) && unique.includes(otherStore))
})

test("scanning preserves an exact legacy match and reports an ambiguous alias", async (t) => {
  globalThis.__APriceConfig = { supabaseUrl: "https://catalog.example", supabaseAnonKey: "fixture" }
  t.after(() => { delete globalThis.__APriceConfig })
  const { fetchProductByBarcode } = await import("../src/lib/aprice-api.mjs")
  const products = [{ id: "first", barcode: "96385074" }, { id: "second", barcode: "000096385074" }]
  t.mock.method(globalThis, "fetch", async url => {
    assert.match(url.searchParams.get("barcode"), /in\.\(96385074,000096385074,/)
    return Response.json(products)
  })
  assert.equal((await fetchProductByBarcode("000096385074")).id, "second")
  await assert.rejects(fetchProductByBarcode("00000096385074"), /多个历史商品/)
  products.pop()
  assert.equal((await fetchProductByBarcode("00000096385074")).id, "first")
})
