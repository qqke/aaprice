import assert from "node:assert/strict"
import test from "node:test"
import { normalizeQols } from "../scripts/retry-qols-products.mjs"

test("QOLS retry uses explicit variant JAN and verifies the requested handle", () => {
  const product = { handle: "test", title: "商品", description: "<p>説明</p>", type: "日用品", images: ["https://example.com/item.png"], variants: [{ barcode: "4901301234568" }] }
  const [row] = normalizeQols(product, "test")
  assert.equal(row.catalogSource, "qols")
  assert.equal(row.description, "説明")
  assert.equal(row.category, "日用品")
  assert.equal(row.imageUrl, product.images[0])
  assert.throws(() => normalizeQols(product, "other"), /Invalid/)
  assert.deepEqual(normalizeQols({ ...product, variants: [{ barcode: "invalid", sku: "N123" }] }, "test"), [])
})
