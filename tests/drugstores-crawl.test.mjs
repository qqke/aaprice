import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildImportSql, deduplicateProducts, parseProduct, parseStore, parseWelciaStore, robotsAllow, validJan } from "../scripts/crawl-drugstores.mjs"

const tsuruha = `<span itemprop="name">クリーム (60g)</span>
<dt>商品番号(JANコード)</dt><dd>4901234210127</dd>
<meta itemprop="price" content="599" />（税込）<div class="stock available">`
const welcia = `<h1 class="p-product-main__name">ザバス 600g</h1><p>JANコード：4902777325378</p>
<p class="p-product-setting-price__tax">(税込:4,298.40円)</p>
<form action="https://www.e-welcia.com/product/add_cart/204537"><button onclick='submitAddCartForm()'>購入にすすむ</button>`
const mk = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "ワイドハイター 820ml", offers: { priceCurrency: "JPY", price: 525, availability: "https://schema.org/InStock" } })}</script>
<big>JANコード</big></dt><dd><big>4901301419989</big></dd><input name="price_tax_included" value="525">`
const tsUrl = "https://shop.tsuruha.co.jp/4901234210127.html"
const mkUrl = "https://www.matsukiyococokara-online.com/store/catalog/product/view/id/4901301419989"

test("explicit import requires server configuration before reading or applying SQL", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/crawl-drugstores.mjs", import.meta.url)), "--import=missing.sql"], {
    env: { ...process.env, AAPRICE_DB_URL: "" }, encoding: "utf8", timeout: 5000,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /AAPRICE_DB_URL/)
  assert.doesNotMatch(result.stdout + result.stderr, /ENOENT|checked|Database connection/)
})

test("only exact JAN, in-stock, single-product tax-inclusive prices qualify", () => {
  assert.equal(validJan("4901234210127"), true)
  assert.equal(validJan("4901234210128"), false)
  assert.equal(validJan("01234567"), false)
  assert.equal(parseProduct("tsuruha", tsuruha, tsUrl).priceYen, 599)
  assert.equal(parseProduct("tsuruha", tsuruha.replace("stock available", "stock unavailable"), tsUrl).eligible, false)
  assert.equal(parseProduct("tsuruha", tsuruha.replace("クリーム", "クリーム ２個セット"), tsUrl).eligible, false)
  assert.throws(() => parseProduct("tsuruha", tsuruha.replace("4901234210127", "4901234210128"), tsUrl), /JAN/)
  assert.throws(() => parseProduct("tsuruha", tsuruha.replace("（税込）", "税抜"), tsUrl), /Tax/)
  assert.throws(() => parseProduct("tsuruha", tsuruha.replace('content="599"', 'content="1e3"'), tsUrl), /format/)
  assert.throws(() => parseProduct("tsuruha", tsuruha, "https://example.com/"), /source URL/)
})

test("Welcia fractional tax prices are preserved, never silently rounded for import", () => {
  const p = parseProduct("welcia", welcia, "https://www.e-welcia.com/product/204537")
  assert.equal(p.priceRaw, "4,298.40")
  assert.equal(p.priceYen, null)
  assert.equal(p.eligible, false)
  assert.deepEqual(p.reviewReasons, ["fractional_tax_price_requires_checkout_rounding_rule"])
  assert.equal(parseProduct("welcia", welcia.replace("4,298.40", "4,298.00"), "https://www.e-welcia.com/product/204537").eligible, true)
  assert.equal(parseProduct("welcia", welcia.replace("4,298.40", "4,298.00").replace("<button", "<button disabled"), "https://www.e-welcia.com/product/204537").eligible, false)
})

test("a bundle sharing a JAN cannot replace a usable single item; stock changes remain current", () => {
  const p = parseProduct("tsuruha", tsuruha, tsUrl, "2026-09-10T00:00:00Z")
  const bundle = { ...p, sourceUrl: tsUrl.replace("4901234210127", "12345678"), eligible: false, collectedAt: "2026-09-11T00:00:00Z" }
  const { unique, review } = deduplicateProducts([p, bundle])
  assert.equal(unique[0].sourceUrl, tsUrl)
  assert.deepEqual(review, [bundle])
  const newer = { ...p, eligible: false, collectedAt: "2026-09-11T00:00:00Z" }
  assert.equal(deduplicateProducts([p, newer]).unique[0].eligible, false)
})

test("Matsukiyo requires agreement between JSON-LD, visible tax price and product JAN", () => {
  assert.equal(parseProduct("matsukiyo", mk, mkUrl).eligible, true)
  assert.throws(() => parseProduct("matsukiyo", mk.replace('value="525"', 'value="526"'), mkUrl), /prices differ/)
  assert.throws(() => parseProduct("matsukiyo", mk, mkUrl.replace("9989", "9988")), /JAN differs/)
})

test("store details require Japanese coordinates and preserve primary trading hours", () => {
  const html = `<meta property="og:title" content="ココカラファイン 新宿店 | 店舗詳細">
  <li class="iconAdd">東京都新宿区1-2<div>Google map</div></li>
  var latitude = 35.69; var longitude = 139.70;
  <tr><th>月曜日</th><td>09:00 ～ 22:00</td><td>10:00 ～ 18:00</td></tr>`
  const url = "https://www.matsukiyococokara-online.com/map?kid=12345"
  const s = parseStore(html, url)
  assert.equal(s.id, "mcc-12345")
  assert.equal(s.address, "東京都新宿区1-2")
  assert.equal(s.chain_name, "ココカラファイン")
  assert.equal(s.hours, "月曜日 09:00 ～ 22:00")
  assert.throws(() => parseStore(html.replace("35.69", "0"), url), /Incomplete/)
})

test("SQL excludes review rows, preserves observation time and prevents source-text injection", () => {
  const p = parseProduct("tsuruha", tsuruha, tsUrl, "2026-09-10T00:00:00.000Z")
  p.name = "test'); drop table public.products; --\\.\n"
  const sql = buildImportSql([p, { ...p, eligible: false, barcode: "REJECTED" }], [])
  assert.doesNotMatch(sql, /drop table public|REJECTED/)
  assert.match(sql, /interval '20 hours'/)
  assert.match(sql, /interval '7 days'/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /店頭価格ではありません/)
  const encoded = sql.match(/decode\('([\da-f]+)'/)[1]
  const rows = JSON.parse(Buffer.from(encoded, "hex").toString("utf8"))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].collectedAt, "2026-09-10T00:00:00.000Z")
  assert.equal(rows[0].name, p.name)
})

test("online price sources use one virtual store per selected brand and exclude Sundrug", () => {
  const a = parseProduct("tsuruha", tsuruha, tsUrl)
  const b = parseProduct("welcia", welcia.replace("4,298.40", "4,298.00"), "https://www.e-welcia.com/product/204537")
  const sql = buildImportSql([a, b], [])
  const decoded = [...sql.matchAll(/decode\('([\da-f]+)'/g)].map((m) => Buffer.from(m[1], "hex").toString("utf8")).join("\n")
  assert.match(decoded, /tsuruha-online/)
  assert.match(decoded, /welcia-online/)
  assert.doesNotMatch(sql, /sundrug/i)
})

test("robots rules protect excluded paths without applying another bot's restrictions", () => {
  const robots = "User-agent: PetalBot\nDisallow: /\nUser-agent: *\nDisallow: /catalogsearch/\nDisallow: /*?*price=\n"
  assert.equal(robotsAllow(robots, "https://shop.tsuruha.co.jp/12345678.html"), true)
  assert.equal(robotsAllow(robots, "https://shop.tsuruha.co.jp/catalogsearch/result/"), false)
  assert.equal(robotsAllow(robots, "https://shop.tsuruha.co.jp/a?price=20"), false)
  assert.equal(robotsAllow("User-agent: *\nDisallow: /\nAllow: /welcia/", "https://store.welcia.co.jp/welcia/api/proxy2/shop/list"), true)
})

test("Tsuruha uses the complete visible address instead of incomplete structured address", () => {
  const data = { "@graph": [{ "@type": "Pharmacy", name: "くすりのレデイ土居田店", address: { addressRegion: "愛媛県", addressLocality: "松山市", streetAddress: "419番地1" }, geo: { latitude: 33.824835, longitude: 132.74623 }, openingHours: ["Mo 09:00-21:00"] }] }
  const html = `<script type="application/ld+json">${JSON.stringify(data)}</script><address>〒790-0056 愛媛県松山市土居田町419番地1</address>`
  assert.equal(parseStore(html, "https://shop.tsuruha-g.com/4427").address, "愛媛県松山市土居田町419番地1")
})

test("Welcia directory rejects inactive locations and separates regular opening hours", () => {
  const s = { code: "1001D", name: "ウエルシア春日部一ノ割店", address_name: "埼玉県春日部市一ノ割1-11-20", status: "normal", coord: { lat: 35.963617, lon: 139.765515 },
    detail_groups: [{ texts: [{ details: [{ code: "00002", value: "ドラッグストア" }, { code: "00007", value: '{"monday":[["09:00","20:00"]],"sunday":[]}' }] }], flags: [{ details: [{ code: "00258", value: true }] }] }] }
  assert.equal(parseWelciaStore(s, "2026-09-10T00:00:00Z").hours, "月 09:00–20:00; 日 休業")
  assert.throws(() => parseWelciaStore({ ...s, status: "closed" }), /inactive/)
  assert.throws(() => parseWelciaStore({ ...s, coord: {} }), /Incomplete/)
  assert.throws(() => parseWelciaStore({ ...s, detail_groups: [] }), /Not listed/)
})
