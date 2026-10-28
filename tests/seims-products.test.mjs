import test from "node:test"
import assert from "node:assert/strict"
import { parseSeimsList, verifySeimsDetail, verifySeimsCandidate, recordSeimsCoverage, readSeimsResponse, summarizeSeimsCompletion, seimsKnownSnapshot } from "../scripts/crawl-seims-products.mjs"
test("Seims known snapshots normalize string identities and reject malformed snapshots", () => {
  assert.deepEqual([...seimsKnownSnapshot({ canonicalBarcodes: ["45191763", "00000045191763"] })], ["00000045191763"])
  assert.equal(seimsKnownSnapshot({ canonicalBarcodes: [] }).size, 0)
  for (const snapshot of [null, {}, { canonicalBarcodes: "45191763" }, { canonicalBarcodes: [45191763] }, { canonicalBarcodes: [null] }, { canonicalBarcodes: ["bad"] }]) assert.throws(() => seimsKnownSnapshot(snapshot), /Invalid known snapshot/)
})
const url = "https://www.seims.co.jp/shop/c/c10/"
const html = (code = "4560389400083", image = code, name = "点鼻薬 30ml") => `<link rel="next" href="https://www.seims.co.jp/shop/c/c10_p2/"><span class="pager-count"><span>2252</span></span><li class="block-pickup-list-p--item js-enhanced-ecommerce-item"><div class="block-pickup-list-p--goods-name"><a href="/shop/g/g${code}/">${name}</a></div><a data-category="点鼻薬(100304)" data-brand=""><img src="/img/goods/S/${image}.jpg" alt="${name}"></a></li>`
test("Seims rejects restricted short codes and zero-padded aliases", () => {
  for (const code of ["02345673", "22345677", "000002345673", "000022345677", "0000002345673", "0000022345677", "00000002345673", "00000022345677"]) assert.equal(parseSeimsList(html(code), url).rows.length, 0)
})
test("Seims binds each list name to the same product URL and main image", () => { const p = parseSeimsList(html(), url); assert.equal(p.rows[0].barcode, "4560389400083"); assert.equal(p.rows[0].category, "点鼻薬"); assert.equal(p.total, 2252); assert.equal(p.next, "https://www.seims.co.jp/shop/c/c10_p2/"); assert.equal(parseSeimsList(html("4560389400083", "4903301316039"), url).rows.length, 0) })
test("Seims excludes invalid identities, local codes and shop bundles", () => { for (const h of [html("4560389400084"), ...["2220000000253", "0405048569630", "0205048569636", "405048569630", "00405048569630"].map(x => html(x)), html("4560389400083", "4560389400083", "点鼻薬 3個セット")]) assert.equal(parseSeimsList(h, url).rows.length, 0); assert.throws(() => parseSeimsList(html(), "https://example.com/shop/c/c10/")); assert.throws(() => parseSeimsList("", url)) })
test("Seims only releases candidates supported by current detail metadata", () => {
  const row = parseSeimsList(html(), url).rows[0]
  const detail = `<meta property="metatag:goods_detail" content="${JSON.stringify({ goods: row.barcode, name: row.name, set_fg: "0" }).replaceAll('"', '&quot;')}"><link rel="canonical" href="${row.sourceUrl}"><meta property="og:image" content="https://www.seims.co.jp/img/goods/L/${row.barcode}.jpg"><dd id="spec_goods">${row.barcode}</dd>`
  assert.equal(verifySeimsDetail(detail, row).barcode, row.barcode)
  assert.equal(verifySeimsDetail(detail.replace('L/4560389400083.jpg', 'L/4560389400083_abc012.jpg'), row).barcode, row.barcode)
  assert.throws(() => verifySeimsDetail(detail.replace('L/4560389400083.jpg', 'L/45603894000834.jpg'), row))
  assert.throws(() => verifySeimsDetail(detail.replace('L/4560389400083.jpg', 'L/4903301316039.jpg'), row))
  assert.throws(() => verifySeimsDetail(detail.replace('&quot;set_fg&quot;:&quot;0&quot;', '&quot;set_fg&quot;:&quot;1&quot;'), row))
  assert.throws(() => verifySeimsDetail(detail, { ...row, name: "Other pack size" }))
})
test("Seims permits same-code hashed images but rejects another numeric code", () => {
  assert.equal(parseSeimsList(html("4560389400083", "4560389400083_abc012"), url).rows.length, 1)
  assert.equal(parseSeimsList(html("4560389400083", "45603894000834"), url).rows.length, 0)
  assert.equal(parseSeimsList(html("4560389400083", "4560389400083", "テスト 2&#215;3cm"), url).rows[0].name, "テスト 2×3cm")
})
test("Seims completeness counts all unique card URLs and notices changing totals", () => {
  const parsed = parseSeimsList(html("4560389400084"), url)
  assert.equal(parsed.rows.length, 0); assert.equal(parsed.cardUrls.length, 1)
  const page = { ...parsed, total: 2 }, seen = new Set()
  let coverage = recordSeimsCoverage(null, page, seen)
  coverage = recordSeimsCoverage(coverage, page, seen)
  assert.equal(coverage.observed, 2); assert.equal(coverage.unique, 1); assert.equal(coverage.complete, false)
  coverage = recordSeimsCoverage(coverage, { ...page, cardUrls: ["https://www.seims.co.jp/shop/g/g4560389400083/"] }, seen)
  assert.equal(coverage.complete, true)
  coverage = recordSeimsCoverage(coverage, { ...page, total: 3 }, seen)
  assert.equal(coverage.totalChanged, true); assert.equal(coverage.complete, false)
})
test("Seims retries temporary failures at the rate gate but never access restrictions", async () => {
  let calls = 0, gates = 0
  const successful = { url, ok: true, text: async () => "page" }
  assert.equal(await readSeimsResponse(url, async () => { if (++calls === 1) throw Error("fetch failed"); return successful }, async () => { gates++ }), "page")
  assert.equal(calls, 2); assert.equal(gates, 2)
  for (const status of [403, 404, 429]) { calls = 0; await assert.rejects(readSeimsResponse(url, async () => { calls++; return { url, ok: false, status } }, async () => {}), new RegExp(`HTTP ${status}`)); assert.equal(calls, 1) }
  calls = 0; await assert.rejects(readSeimsResponse(url, async () => { calls++; throw Error("fetch failed") }, async () => {}), /fetch failed/); assert.equal(calls, 3)
  calls = 0; await assert.rejects(readSeimsResponse(url, async () => { calls++; return { ...successful, url: "https://example.com/" } }, async () => {}), /outside/); assert.equal(calls, 1)
})
test("Seims separates completed processing from changing catalog totals", () => {
  const report = { remainingPages: [], failures: [], categories: { 20: { totalChanged: true } }, detailsComplete: true, listComplete: false }
  assert.deepEqual(summarizeSeimsCompletion(report, "done"), { paginationComplete: true, countsStable: false, processingFinished: true, finishedAt: "done" })
  assert.equal(report.listComplete, false)
  assert.equal(summarizeSeimsCompletion({ ...report, remainingPages: [url] }).processingFinished, false)
  assert.equal(summarizeSeimsCompletion({ ...report, detailsComplete: false }).finishedAt, null)
})
test("Seims isolates missing details but propagates access restrictions and network failures", async () => {
  const row = parseSeimsList(html(), url).rows[0]
  const missing = await verifySeimsCandidate(row, async () => { throw Object.assign(Error('HTTP 404 missing'), { status: 404 }) })
  assert.equal(missing.excluded.status, 404)
  assert.equal(missing.excluded.url, row.sourceUrl)
  for (const status of [403, 429, 503]) await assert.rejects(verifySeimsCandidate(row, async () => { throw Object.assign(Error(`HTTP ${status}`), { status }) }), new RegExp(`HTTP ${status}`))
  await assert.rejects(verifySeimsCandidate(row, async () => { throw Error('fetch failed') }), /fetch failed/)
  assert.ok((await verifySeimsCandidate(row, async () => '')).excluded)
})
