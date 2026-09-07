import assert from "node:assert/strict"
import test from "node:test"
import { readCatalogState } from "../src/lib/catalog-state.mjs"

test("catalog return preserves view state and rejects stale or malformed caches", () => {
  const state = { savedAt: 1000000, catalog: [{ id: "1", name: "商品", offers: [], tags: [] }], query: "化粧水", segment: "护肤", budget: 2500, sort: "price", filtersOpen: true, hasMore: true, scrollY: 720, userId: "user-1" }
  const restored = readCatalogState(JSON.stringify(state), 1000001)
  assert.equal(restored.query, "化粧水")
  assert.equal(restored.scrollY, 720)
  assert.equal(restored.budget, 2500)
  assert.equal(restored.userId, "user-1")
  assert.equal(readCatalogState(JSON.stringify(state), 2000000), null)
  assert.equal(readCatalogState(JSON.stringify(state), 1), null)
  assert.equal(readCatalogState("bad"), null)
  assert.equal(readCatalogState(JSON.stringify({ ...state, catalog: [null] }), 1000001), null)
})
