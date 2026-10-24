import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../src/lib/aprice-api.mjs", import.meta.url), "utf8")
const start = source.indexOf("export async function searchProducts(")
const handler = source.slice(start, source.indexOf("\nexport async function fetchProductByBarcode", start)).replace("export ", "")

test("initial catalog and pagination read products without ranking or location", async () => {
  const requests = []
  const rows = [{ id: "real-product" }]
  const search = new Function("request", "rpc", "escapeIlike", `${handler}; return searchProducts`)(
    async (path, options) => { requests.push({ path, ...options }); return rows },
    () => assert.fail("the initial catalog must not wait on ranking"),
    (value) => value,
  )
  assert.deepEqual(await search(), rows)
  assert.deepEqual(await search("", 30, { offset: 30 }), rows)
  assert.deepEqual(requests.map(({ path, query }) => [path, query.limit, query.offset]), [["products", 30, 0], ["products", 30, 30]])
  assert.equal(requests[0].query.order, "last_seen_at.desc.nullslast,updated_at.desc")
  await search("商品")
  assert.match(requests[2].query.or, /name.ilike.%商品%/)
})

test("discovery prioritizes ranked products, keeps full search, and falls back on ranking failure", async () => {
  const calls = []
  let unavailable = false
  const search = new Function("request", "rpc", "escapeIlike", `${handler}; return searchProducts`)(
    async (path, options) => { calls.push({ path, ...options }); return [{ id: "catalog" }] },
    async (path, body) => { calls.push({ path, body }); if (unavailable) throw new Error("timeout"); return [{ id: "ranked" }] },
    (value) => value,
  )
  assert.deepEqual(await search("", 30, { curated: true }), [{ id: "ranked" }])
  await search("", 30, { curated: true, offset: 30 })
  assert.equal(calls[1].body.payload.offset, 30)
  await search("4987241155712", 30, { curated: true })
  assert.equal(calls[2].path, "products")
  assert.match(calls[2].query.or, /barcode.ilike/)
  unavailable = true
  assert.deepEqual(await search("", 30, { curated: true }), [{ id: "catalog" }])
  assert.equal(calls.at(-1).path, "products")
})
