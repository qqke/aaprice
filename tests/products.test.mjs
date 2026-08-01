import test from "node:test"
import assert from "node:assert/strict"
import { filterProducts, getClosestOffer, products } from "../src/lib/products.mjs"
import { friendlyApiError, isMissingRelationError, mapProductRow, offersFromPriceRows, parseJancodeProductDraft } from "../src/lib/aprice-api.mjs"

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

test("keeps unpriced products stable when sorting by distance", () => {
  const location = { lat: 35.6595, lng: 139.7005 }
  const unpriced = { ...products[0], id: "unpriced", offers: [] }
  assert.deepEqual(filterProducts([unpriced, products[0]], { sort: "distance", location }).map(({ id }) => id), [products[0].id, "unpriced"])
  assert.doesNotThrow(() => filterProducts([unpriced], { sort: "distance", location }))
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

test("infers useful drugstore categories when imported rows have none", () => {
  assert.equal(mapProductRow({ id: "1", name: "【第3類医薬品】ハイシーL 40錠" }).category, "医药品")
  assert.equal(mapProductRow({ id: "2", name: "コーセー 薬用雪肌精 乳液" }).category, "护肤美妆")
  assert.equal(mapProductRow({ id: "3", name: "マルチビタミンサプリ" }).category, "营养保健")
})

test("rejects JANCODE upstream error pages", () => {
  assert.equal(parseJancodeProductDraft("Warning: Target URL returned error 403\n## アクセスしようとしたページは表示できませんでした。", "4999999999999"), null)
})

test("translates price task empty and daily limit states", () => {
  assert.equal(friendlyApiError(new Error("no_price_tasks_available")), "当前没有可领取的补价任务。")
  assert.equal(friendlyApiError(new Error("daily_task_claim_limit_reached")), "今天领取任务的次数已达上限。")
})

test("recognizes optional Supabase relation failures", () => {
  assert.equal(isMissingRelationError(new Error("Could not find the table 'public.product_submissions' in the schema cache")), true)
  assert.equal(isMissingRelationError(new Error('relation "product_submissions" does not exist')), true)
  assert.equal(isMissingRelationError(new Error("network error")), false)
})
