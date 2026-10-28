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

test("UPC and zero-prefixed EAN forms share one identity without changing the source barcode", () => {
  const result = prepareRows([{ ...product, barcode: "705928001206" }, { ...product, barcode: "0705928001206" }])
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].barcode, "705928001206")
  assert.equal(result.duplicates, 1)
})

test("accepts verified new catalog origins and rejects lookalike domains", () => {
  for (const [catalogSource, origin] of [["lion", "https://map.lion.co.jp"], ["kirindo", "https://www.kirindo-shop.com"], ["welcia", "https://www.e-welcia.com"], ["unicharm", "https://map.unicharm.co.jp"], ["tsuruha", "https://shop.tsuruha.co.jp"], ["create", "https://netshop.create-sd.co.jp"], ["kyorindo", "https://www.kyorindo-onlineshop.jp"], ["doramori", "https://net-shop.doramori.co.jp"]]) {
    assert.equal(prepareRows([{ ...product, catalogSource, sourceUrl: `${origin}/product` }]).rows.length, 1)
    assert.equal(prepareRows([{ ...product, catalogSource, sourceUrl: `${origin}.evil.invalid/product` }]).excluded.length, 1)
  }
})

test("rejects store circulation codes including equivalent UPC and padded forms", () => {
  for (const barcode of ["2220000000253", "0405048569630", "0205048569636", "405048569630", "00405048569630"]) {
    assert.equal(validGtin(barcode), true)
    const result = prepareRows([{ ...product, barcode }])
    assert.equal(result.rows.length, 0)
    assert.equal(result.excluded[0].reason, "Restricted circulation code")
  }
  assert.equal(prepareRows([{ ...product, barcode: "705928001206" }]).rows.length, 1)
})

test("accepts Seims and existing-brand official catalogs without accepting lookalikes", () => {
  for (const [catalogSource, origin] of [["seims", "https://www.seims.co.jp"], ["kai", "https://store.kai-group.com"], ["elpa", "https://www.elpadirect.jp"], ["fujiyaku", "https://www.fujiyaku-direct.com"]]) {
    assert.equal(prepareRows([{ ...product, catalogSource, sourceUrl: `${origin}/product` }]).rows.length, 1)
    assert.equal(prepareRows([{ ...product, catalogSource, sourceUrl: `${origin}.invalid/product` }]).rows.length, 0)
  }
})

test("accepts official Ohm and Soft99 catalogs while rejecting lookalikes", () => {
  for (const [catalogSource, origin] of [["ohm", "https://www.ohm-direct.com"], ["soft99", "https://www.soft99.co.jp"]]) {
    assert.equal(prepareRows([{ ...product, catalogSource, sourceUrl: `${origin}/product` }]).rows.length, 1)
    assert.equal(prepareRows([{ ...product, catalogSource, sourceUrl: `${origin}.invalid/product` }]).rows.length, 0)
  }
})

test("rejects short internal circulation codes and zero-padded aliases while retaining global GTIN-8", () => {
  for (const raw of ["02345673", "22345677"]) for (const length of [8, 12, 13, 14]) {
    const barcode = raw.padStart(length, "0")
    assert.equal(validGtin(barcode), true)
    const result = prepareRows([{ ...product, barcode }])
    assert.equal(result.rows.length, 0)
    assert.equal(result.excluded[0].reason, "Restricted circulation code")
  }
  for (const length of [8, 12, 13, 14]) assert.equal(prepareRows([{ ...product, barcode: "96385074".padStart(length, "0") }]).rows.length, 1)
})

test("holds retailer cartons without rejecting native multipacks or storage cases", () => {
  for (const name of ["飲料 525ml×24本(1ケース)", "飲料 １ケース 250ml×30本", "つゆ 1L(1ケース6本)"]) {
    const checked = prepareRows([{ ...product, name }])
    assert.equal(checked.rows.length, 0)
    assert.equal(checked.excluded[0].reason, "Retail carton requires pack-level GTIN verification")
  }
  for (const name of ["ジキナD30ロイヤル 30ml×10本", "チュチュ おでかけ消毒ケース 1個入"]) assert.equal(prepareRows([{ ...product, name }]).rows.length, 1)
})

test("import SQL inserts only with collision guards and verifies old records before commit", () => {
  const sql = insertSql(prepareRows([product]).rows)
  assert.match(sql, /on conflict do nothing/)
  assert.match(sql, /p.barcode = s.barcode or p.id = s.barcode/)
  assert.match(sql, /lpad\(p.barcode, 14, '0'\) = lpad\(s.barcode, 14, '0'\)/)
  assert.match(sql, /md5\(to_jsonb\(p\)::text\) <> b.fingerprint/)
  assert.match(sql, /lock table public.products in share row exclusive mode/)
  assert.doesNotMatch(sql, /\bupdate public\.|\bdelete\b|insert into public.prices|enqueue_price_alert/i)
  assert.ok(sql.indexOf("Existing products changed") < sql.indexOf("commit;"))
})
