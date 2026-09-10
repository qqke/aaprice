import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../src/components/CommercialProductSearch.jsx", import.meta.url), "utf8")
const handler = source.slice(source.indexOf("  const search = async"), source.indexOf("\n  return <section"))
function setup(query, searchProducts) {
  const state = { rows: [{ id: "old" }], message: "", busy: false }
  const context = { query, searchProducts, pending: { current: false },
    setRows(value) { state.rows = value }, setMessage(value) { state.message = value },
    setBusy(value) { state.busy = value }, friendlyApiError: (error) => error.message }
  const search = new Function(...Object.keys(context), `${handler}; return search`)(...Object.values(context))
  return { state, run: () => search({ preventDefault() {} }) }
}
test("commercial search queries the full catalog and blocks duplicate submissions", async () => {
  let resolve, calls = 0
  const fixture = [{ id: "outside-first-500", name: "商品" }]
  const { state, run } = setup(" 4901234567890 ", (query, limit, options) => {
    calls++
    assert.equal(query, "4901234567890")
    assert.equal(limit, 50)
    assert.deepEqual(options, { curated: false })
    return new Promise((done) => { resolve = done })
  })
  const first = run()
  await run()
  assert.equal(calls, 1)
  assert.equal(state.busy, true)
  resolve(fixture)
  await first
  assert.deepEqual(state.rows, fixture)
  assert.equal(state.busy, false)
})
test("empty, failed and capped searches give truthful feedback without stale results", async () => {
  const empty = setup(" ", () => assert.fail("must not query"))
  await empty.run()
  assert.deepEqual(empty.state.rows, [])
  assert.match(empty.state.message, /请输入/)
  const failed = setup("JAN", async () => { throw new Error("offline") })
  await failed.run()
  assert.deepEqual(failed.state.rows, [])
  assert.match(failed.state.message, /搜索失败/)
  assert.equal(failed.state.busy, false)
  const capped = setup("商品", async () => Array.from({ length: 50 }, (_, id) => ({ id })))
  await capped.run()
  assert.match(capped.state.message, /前 50 件/)
})
test("selecting a commercial product preserves offer draft fields and deduplicates options", () => {
  const admin = readFileSync(new URL("../src/components/AdminApp.jsx", import.meta.url), "utf8")
  const selection = admin.slice(admin.indexOf("  const selectCommercialProduct ="), admin.indexOf("  const findProducts ="))
  let products = [], form = { id: "offer", destination_url: "https://example.com/item", partner: "rakuten", campaign: "pilot", product_id: "old" }
  const select = new Function("setProducts", "setCommercialForm", `${selection}; return selectCommercialProduct`)((update) => { products = update(products) }, (update) => { form = update(form) })
  select({ id: "new", name: "商品" })
  select({ id: "new", name: "商品" })
  assert.equal(products.length, 1)
  assert.deepEqual(form, { id: "offer", destination_url: "https://example.com/item", partner: "rakuten", campaign: "pilot", product_id: "new", product_name: "商品" })
  assert.match(admin, /commercialForm\.product_name \|\| commercialForm\.product_id/)
})
