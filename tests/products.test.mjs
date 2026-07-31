import test from "node:test"
import assert from "node:assert/strict"
import { filterProducts, getClosestOffer, products } from "../src/lib/products.mjs"
import { mapProductRow, offersFromPriceRows, parseJancodeProductDraft } from "../src/lib/aprice-api.mjs"

test("searches JAN and sorts filtered drugstore products without mutating source data", () => {
  const originalOrder = products.map(({ id }) => id)
  assert.deepEqual(filterProducts(products, { query: "4987-1881-61027" }).map(({ id }) => id), ["loxonin-s"])

  const result = filterProducts(products, {
    query: "錠",
    segment: "止痛退热",
    maxPrice: 1200,
    sort: "unit",
  })
  assert.deepEqual(result.map(({ id }) => id), ["eve-a", "tylenol-a", "loxonin-s"])
  assert.deepEqual(products.map(({ id }) => id), originalOrder)
})

test("finds the nearest priced store", () => {
  const product = products.find(({ id }) => id === "loxonin-s")
  assert.equal(getClosestOffer(product, { lat: 35.6595, lng: 139.7005 }).name, "マツモトキヨシ 渋谷店")
})

test("maps Supabase products and keeps only the latest price per store", () => {
  const product = mapProductRow({ id: "p1", barcode: "4901234567894", name: "测试商品", brand: "测试品牌", pack: "24錠", category: "医薬品" })
  const offers = offersFromPriceRows([
    { store_id: "s1", price_yen: 900, collected_at: "2026-07-01T00:00:00Z", stores: { id: "s1", name: "门店一", lat: 35, lng: 139 } },
    { store_id: "s1", price_yen: 780, collected_at: "2026-07-10T00:00:00Z", stores: { id: "s1", name: "门店一", lat: 35, lng: 139 } },
    { store_id: "s2", price_yen: 820, collected_at: "2026-07-08T00:00:00Z", stores: { id: "s2", name: "门店二", lat: 36, lng: 140 } },
  ])

  assert.equal(product.amount, 24)
  assert.equal(product.unit, "錠")
  assert.deepEqual(offers.map(({ id, price }) => [id, price]), [["s1", 780], ["s2", 820]])
})

test("rejects JANCODE upstream error pages", () => {
  assert.equal(parseJancodeProductDraft("Warning: Target URL returned error 403\n## アクセスしようとしたページは表示できませんでした。", "4999999999999"), null)
})
