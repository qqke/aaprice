import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createFetcher, validateStore } from './crawl-national-stores.mjs'
import { buildImportSql } from './crawl-drugstores.mjs'

const uncomment = s => s.replace(/<!--[\s\S]*?-->/g, '')
const clean = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;|&#038;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const field = (s, label) => clean(s.match(new RegExp(`<dt>\\s*${label}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`))?.[1])
export function parseOhga(block, collectedAt) {
  assert(/class="drugstore"/.test(block), 'Not explicitly a retail drugstore')
  const id = block.match(/\/shop\/detail\/\?id=(\d+)/)?.[1]
  const coord = block.match(/destination=\s*([\d.]+)\s*,\s*([\d.]+)/)
  const name = clean(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1])
  assert(id && coord && name, 'Missing store identity or destination coordinates')
  // Notices may refer to past closures; retain them for review instead of guessing dates.
  assert(!/閉店|休業|オープン予定/.test(clean(block)), 'Closure/opening notice requires review')
  return validateStore({ id: `ohga-${id}`, name, chain_name: name.startsWith('グリーンドラッグ') ? 'グリーンドラッグ' : '大賀薬局',
    address: field(block, '住所').replace(/^〒[\d-]+\s*/, ''), phone: field(block, '電話番号'), hours: field(block, '営業時間'),
    lat: Number(coord[1]), lng: Number(coord[2]), taxFree: null, sourceUrl: `https://www.ohga-ph.com/shop/detail/?id=${id}`,
    coordinateEvidence: 'Official directions destination', collectedAt })
}
export function parseEvergreenList(html, collectedAt, sourceListUrl) {
  return [...uncomment(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(([, row]) => {
    const link = row.match(/<th class="td01">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/)
    if (!link) return []
    const addressPhone = clean(row.match(/<td class="td02">([\s\S]*?)<\/td>/)?.[1])
    const [address, phone] = addressPhone.split(/\s*TEL\.\s*/)
    assert(address && phone, 'Unrecognized address/phone row')
    const sourceUrl = link[1], name = clean(link[2])
    return [{ id: `evergreen-${createHash('sha256').update(sourceUrl).digest('hex').slice(0,16)}`, name,
      chain_name: name.startsWith('スーパー') ? 'スーパーエバグリーン' : 'エバグリーン', address, phone,
      hours: clean(row.match(/<td class="td03">([\s\S]*?)<\/td>/)?.[1]), taxFree: null,
      sourceUrl, sourceListUrl, collectedAt }]
  })
}
export function parseEvergreenCoordinates(html) {
  // The place query identifies a location; never use embed viewport !2d/!3d or map center.
  const coord = uncomment(html).match(/maps\/embed\/v1\/place\?[^"<>]*[&?]q=\s*([\d.]+),\s*([\d.]+)/)
  assert(coord, 'No official place coordinates')
  return { lat: Number(coord[1]), lng: Number(coord[2]), coordinateEvidence: 'Official embedded map place query' }
}

async function main() {
  const out = process.argv.find(x => x.startsWith('--out='))?.slice(6) || 'artifacts/drugstores-regional-retail-2026-09-13'
  const get = await createFetcher(out, process.argv.includes('--offline'), process.argv.includes('--resume'))
  const stores = [], pending = [], sources = [], failures = []
  const start = 'https://www.ohga-ph.com/shop/?store_type%5B%5D=3'
  const queue = [start], visited = new Set(), ids = new Set()
  let expected, discovered = 0, accepted = 0
  while (queue.length) {
    const url = queue.shift()
    const pageNumber = new URL(url).searchParams.get('pageID') || '1'
    if (visited.has(pageNumber)) continue
    assert(visited.size < 30, 'Unexpected pagination growth')
    visited.add(pageNumber)
    const page = await get(url), html = uncomment(page.html)
    const total = Number(html.match(/検索結果：\s*全(\d+)件/)?.[1])
    assert(total > 0, 'Missing official total')
    expected ??= total
    assert.equal(total, expected, 'Directory total changed during crawl')
    for (const [, block] of html.matchAll(/<section class="shopDetail">([\s\S]*?)<\/section>/g)) {
      const id = block.match(/\/shop\/detail\/\?id=(\d+)/)?.[1]
      assert(id && !ids.has(id), 'Missing or duplicate Ohga ID')
      ids.add(id); discovered++
      try { stores.push({ ...parseOhga(block, page.collectedAt), sourceListUrl: url }); accepted++ }
      catch(e) { pending.push({source:'ohga', id, name:clean(block.match(/<h2>([\s\S]*?)<\/h2>/)?.[1]),
        address:field(block,'住所'), phone:field(block,'電話番号'), hours:field(block,'営業時間'),
        sourceUrl:`https://www.ohga-ph.com/shop/detail/?id=${id}`, sourceListUrl:url, collectedAt:page.collectedAt, reason:e.message}) }
    }
    for (const [, href] of html.matchAll(/href="([^"]*pageID=[^"]+)"/g)) {
      const next = new URL(href.replaceAll('&amp;', '&'), url)
      assert.equal(next.origin, new URL(start).origin)
      if (!visited.has(next.searchParams.get('pageID') || '1') && !queue.includes(next.href)) queue.push(next.href)
    }
  }
  assert.equal(discovered, expected, 'Incomplete Ohga enumeration')
  sources.push({source:'ohga', expected, discovered, accepted, pages:visited.size, enumerationComplete:true})
  const candidates = new Map()
  for (const category of ['store_evergreen','store_superevergreen']) {
    const url = `https://hirooka-g.co.jp/store/${category}/`, page = await get(url)
    const rows = parseEvergreenList(page.html, page.collectedAt, url)
    assert(rows.length > 0, 'Empty Evergreen category')
    for (const row of rows) candidates.set(row.sourceUrl, row)
  }
  let evergreenAccepted = 0
  for (const row of candidates.values()) {
    try {
      const page = await get(row.sourceUrl), html = uncomment(page.html)
      assert(/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(row.address), 'Official list address missing prefecture; requires review')
      const coords = parseEvergreenCoordinates(html)
      stores.push(validateStore({...row, ...coords, collectedAt:page.collectedAt})); evergreenAccepted++
    } catch(e) { pending.push({...row, reason:e.message}); failures.push({url:row.sourceUrl, reason:e.message}) }
    console.log(`Evergreen ${evergreenAccepted + failures.length}/${candidates.size}`)
  }
  sources.push({source:'evergreen', discovered:candidates.size, accepted:evergreenAccepted, enumerationComplete:true,
    scope:'Official Evergreen and Super Evergreen category directories; other Hirooka supermarket brands excluded'})
  assert.equal(new Set(stores.map(s=>s.id)).size, stores.length)
  for (const [file, value] of Object.entries({'stores.json':stores,'pending.json':pending,'report.json':{
    generatedAt:new Date().toISOString(), sources, accepted:stores.length, pending:pending.length, failures, applied:false}})) {
    await writeFile(`${out}/${file}`, JSON.stringify(value,null,2))
  }
  await writeFile(`${out}/import.sql`, buildImportSql([],stores))
  console.log(JSON.stringify({out,sources,accepted:stores.length,pending:pending.length}))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e);process.exitCode=1})
