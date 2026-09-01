import assert from "node:assert/strict"
import test from "node:test"
import { csvCell, normalizeProduct, syncSql } from "../scripts/sync-sundrug.mjs"

test("normalizes priced Sandrug variants without inventing identifiers", () => {
  const rows = normalizeProduct({
    title: "テスト\n商品",
    vendor: "テスト製薬",
    product_type: "医薬品",
    tags: ["常温", "医薬品・医薬部外品", "目薬"],
    body_html: "<p>乾いた目に&nbsp;うるおい。</p>",
    images: [{ src: "https://cdn.example/product.jpg" }],
    variants: [
      { barcode: "0012345678901", title: "Default Title", price: "1,280", available: true },
      { sku: "4901234567890", title: "2個セット", price: "2400", available: false },
      { sku: "4901234567891", title: "1", price: "980", available: true },
      { sku: "not-a-jan", title: "無効", price: "100", available: true },
    ],
  })

  assert.deepEqual(rows, [
    {
      barcode: "0012345678901",
      name: "テスト 商品",
      brand: "テスト製薬",
      pack: "",
      category: "医薬品",
      description: "乾いた目に うるおい。",
      imageUrl: "https://cdn.example/product.jpg",
      priceYen: 1280,
      available: true,
    },
    {
      barcode: "4901234567890",
      name: "テスト 商品",
      brand: "テスト製薬",
      pack: "2個セット",
      category: "医薬品",
      description: "乾いた目に うるおい。",
      imageUrl: "https://cdn.example/product.jpg",
      priceYen: 2400,
      available: false,
    },
    {
      barcode: "4901234567891",
      name: "テスト 商品",
      brand: "テスト製薬",
      pack: "",
      category: "医薬品",
      description: "乾いた目に うるおい。",
      imageUrl: "https://cdn.example/product.jpg",
      priceYen: 980,
      available: true,
    },
  ])
})

test("escapes CSV cells for psql copy", () => {
  assert.equal(csvCell('薬用 "A", 30錠'), '"薬用 ""A"", 30錠"')
  assert.equal(csvCell(false), '"false"')
})

test("writes catalog changes and fresh prices atomically", () => {
  const sql = syncSql([{
    barcode: "4901234567890",
    name: "商品",
    brand: "品牌",
    pack: "",
    category: "",
    description: "",
    imageUrl: "",
    priceYen: 980,
    available: true,
  }])

  assert.match(sql, /begin;/)
  assert.match(sql, /is distinct from/)
  assert.match(sql, /catalog_source = 'sundrug'/)
  assert.match(sql, /product\.pack ~ '\^\\d\+\$'/)
  assert.match(sql, /description = coalesce\(nullif\(stage\.description, ''\), product\.description\)/)
  assert.match(sql, /last_seen_at = now\(\)/)
  assert.match(sql, /recent\.collected_at >= now\(\) - interval '20 hours'/)
  assert.match(sql, /select public\.enqueue_price_alert_deliveries\(\) as alerts_queued/)
  assert.match(sql, /commit;/)
})
