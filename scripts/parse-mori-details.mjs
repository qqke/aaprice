import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createFetcher } from './crawl-national-stores.mjs'
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
export function parseMoriDetail(html, url, collectedAt) {
  const field = name => plain(html.match(new RegExp(`<dt[^>]*>\\s*${name}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i'))?.[1] || '')
  const name = plain(html.match(/<h1 class="ttl[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
  const address = field('住所').replace(/^〒\s*[\d-]+\s*/, '')
  if (!name || !/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(address)) throw Error('Not a store detail with Japanese address')
  return { id: `mori:${encodeURIComponent(url)}`, chain_name: 'ドラッグストアモリ', name, address, phone: field('電話番号'), hours: field('営業時間'), sourceUrl: url, source: 'drugstore-mori', collectedAt, lat: null, lng: null }
}
async function main() {
  const out = 'artifacts/drugstores-mori-2026-09-13'
  const get = await createFetcher(out, process.argv.includes('--offline'), process.argv.includes('--resume'))
  const index = await get('https://www.doramori.co.jp/store/')
  const urls = [...new Set([...index.html.matchAll(/<h4 class="name">\s*<a href="([^"]+)"/g)].map(m => m[1]))]
  if (!urls.length) throw Error('No store detail URLs in official directory')
  await fs.writeFile(`${out}/index-urls.json`, JSON.stringify(urls, null, 2))
  const stores = [], failures = []
  async function save(complete) {
    await fs.writeFile(`${out}/stores-addresses.json`, JSON.stringify(stores, null, 2))
    await fs.writeFile(`${out}/report-details.json`, JSON.stringify({ source: 'drugstore-mori', sourceUrl: index.url, generatedAt: new Date().toISOString(), discovered: urls.length, processed: stores.length + failures.length, accepted: stores.length, failures, coordinates: 0, enumerationComplete: complete, databaseApplied: false, status: 'Official maps embed uses address query, no explicit coordinates; retained as address directory pending coordinates' }, null, 2))
  }
  for (const url of urls) {
    try { const page = await get(url); stores.push(parseMoriDetail(page.html, url, page.collectedAt)) }
    catch (e) { failures.push({ url, reason: e.message }) }
    if ((stores.length + failures.length) % 20 === 0) { await save(false); console.log(JSON.stringify({ accepted: stores.length, failures: failures.length, total: urls.length })) }
  }
  await save(true)
  console.log(JSON.stringify({ accepted: stores.length, failures: failures.length, total: urls.length }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
