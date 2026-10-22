import assert from "node:assert/strict"
import test from "node:test"
import { insertSql, prepareRows, validGtin } from "../scripts/import-new-products.mjs"

const product = { barcode: "4901301234568", name: "商品", catalogSource: "kao", sourceUrl: "https://www.kao-kirei.com/jp/ja/item/test/" }

test("checks GTIN digits without converting leading zeroes", () => {
  assert.equal(validGtin(product.barcode), true)
  assert.equal(validGtin("00012345600012"), true)
  for (const value of [4901301234568, "4901301234565", "123", "4901301234568 "]) assert.equal(validGtin(value), false)
})

test("deduplicates by GTIN and excludes invalid or untrusted records", () => {
  const result = prepareRows([product, { ...product, name: "duplicate" }, { ...product, barcode: "4901301234565" }, { ...product, sourceUrl: "https://evil.invalid/" }, null])
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].name, "商品")
  assert.equal(result.duplicates, 1)
  assert.equal(result.excluded.length, 3)
})

test("import SQL inserts only with collision guards and verifies old records before commit", () => {
  const sql = insertSql(prepareRows([product]).rows)
  assert.match(sql, /on conflict do nothing/)
  assert.match(sql, /p.barcode = s.barcode or p.id = s.barcode/)
  assert.match(sql, /md5\(to_jsonb\(p\)::text\) <> b.fingerprint/)
  assert.match(sql, /lock table public.products in share row exclusive mode/)
  assert.doesNotMatch(sql, /\bupdate public\.|\bdelete\b|insert into public.prices|enqueue_price_alert/i)
  assert.ok(sql.indexOf("Existing products changed") < sql.indexOf("commit;"))
})
