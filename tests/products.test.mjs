import test from "node:test"
import assert from "node:assert/strict"
import { filterProducts, getBasketSummary, getBestSingleStoreBasket, getClosestOffer, getCompareSelectionFromSearch, getMapUrl, getPriceFreshness, isOnlineStore, products, sanitizeCompareSelection, sanitizePriceSnapshots } from "../src/lib/products.mjs"
import { friendlyApiError, isMissingRelationError, mapProductRow, offersFromPriceRows, parseCommercialOfferRows, parseJancodeProductDraft } from "../src/lib/aprice-api.mjs"

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

test("keeps only fresh validated local price snapshots", () => {
  const now = Date.parse("2026-08-24T10:00:00Z")
  const snapshots = sanitizePriceSnapshots({
    fresh: { savedAt: now - 60_000, offers: [{ id: "store-1", name: "门店", price: 880, lat: 35, lng: 139, sampledAt: "2026-08-24T09:00:00Z", email: "drop@example.com" }] },
    expired: { savedAt: now - 7 * 60 * 60 * 1000, offers: [{ id: "store-2", name: "旧门店", price: 700 }] },
    invalid: { savedAt: now, offers: [{ id: "store-3", name: "异常价格", price: -1 }] },
  }, now)
  assert.deepEqual(Object.keys(snapshots), ["fresh"])
  assert.equal(snapshots.fresh.offers[0].price, 880)
  assert.equal("email" in snapshots.fresh.offers[0], false)
})

test("finds the nearest priced store", () => {
  const product = products.find(({ id }) => id === "loxonin-s")
  assert.equal(getClosestOffer(product, { lat: 35.6595, lng: 139.7005 }).name, "マツモトキヨシ 渋谷店")
})

test("does not treat online quotes as nearby physical stores", () => {
  const online = { id: "sundrug-00000", name: "オンラインショップ-サンドラッグ", lat: 35.7, lng: 139.7, price: 700 }
  assert.equal(isOnlineStore(online), true)
  assert.equal(getClosestOffer({ offers: [online] }, { lat: 35.7, lng: 139.7 }), null)
  assert.equal(getBestSingleStoreBasket([{ offers: [online] }]), null)
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

test("parses bulk commercial links without accepting duplicates or unsafe URLs", () => {
  assert.deepEqual(parseCommercialOfferRows("p1\thttps://example.com/1\np2 https://example.com/2"), [
    { product_id: "p1", destination_url: "https://example.com/1" },
    { product_id: "p2", destination_url: "https://example.com/2" },
  ])
  assert.throws(() => parseCommercialOfferRows("p1 http://example.com"), /HTTPS/)
  assert.throws(() => parseCommercialOfferRows("p1 https://example.com/1\np1 https://example.com/2"), /不重复/)
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

test("labels price freshness without hiding stale quotes", () => {
  const now = Date.parse("2026-08-18T12:00:00Z")
  assert.deepEqual(getPriceFreshness("2026-08-18T02:00:00Z", now), { ageDays: 0, label: "今日采集", stale: false })
  assert.deepEqual(getPriceFreshness("2026-08-11T12:00:00Z", now), { ageDays: 7, label: "7 天前采集", stale: false })
  assert.equal(getPriceFreshness("2026-07-01T12:00:00Z", now).stale, true)
  assert.equal(getPriceFreshness(null, now).label, "更新时间未知")
})

test("summarizes only priced shopping-list items and sanitizes saved ids", () => {
  const priced = products.slice(0, 2)
  const unpriced = { ...products[2], offers: [] }
  const summary = getBasketSummary([...priced, unpriced])
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.pricedCount, 2)
  assert.equal(summary.minimumTotal, priced.reduce((total, product) => total + Math.min(...product.offers.map(({ price }) => price)), 0))
  assert.deepEqual(getBestSingleStoreBasket(priced), { id: "sundrug-ikebukuro", name: "サンドラッグ 池袋駅前店", address: undefined, lat: 35.7296, lng: 139.7101, total: 1708, premium: 72, includesMemberPrice: false })
  assert.equal(getBestSingleStoreBasket([...priced, unpriced]), null)
  assert.equal(getMapUrl({ lat: 35.7, lng: 139.7 }), "https://www.google.com/maps/search/?api=1&query=35.7%2C139.7")
  assert.equal(getMapUrl({ name: "测试门店", address: "东京" }), "https://www.google.com/maps/search/?api=1&query=%E6%B5%8B%E8%AF%95%E9%97%A8%E5%BA%97%20%E4%B8%9C%E4%BA%AC")
  assert.deepEqual(sanitizeCompareSelection(["a", "", "a", null, "b"], 2), ["a", "b"])
  assert.deepEqual(getCompareSelectionFromSearch("?compare=a%2Cb%2Ca%2C%2Cc"), ["a", "b", "c"])
})
