import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createFetcher, validateStore } from './crawl-national-stores.mjs'
import { buildImportSql } from './crawl-drugstores.mjs'
import {getOfficialEmbedMarker} from './official-embed-marker.mjs'

const base = 'https://www.zagzag.co.jp/shops/'
const plain = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
export function parseZagzag(html, url, collectedAt) {
  const name = plain(html.match(/<title>\s*([^<|]+)/i)?.[1])
  const address = plain(html.match(/>住所<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/)?.[1]).replace(/^〒[\d-]+\s*/, '')
  const retail = html.match(/<h3[^>]*class="[^"]*shop-single__label -main[^>]*>店舗<\/h3>\s*(<table[\s\S]*?<\/table>)/)?.[1]
  if (!retail || /閉店|閉鎖|オープン予定/.test(name)) throw Error('Not an active retail drugstore')
  const hours = plain(retail.match(/<th>営業時間<\/th>\s*<td>([\s\S]*?)<\/td>/)?.[1])
  if (!hours || /閉店|休業/.test(hours)) throw Error('No active retail opening hours')
  const phone = plain(retail.match(/<th>電話番号<\/th>\s*<td>([\s\S]*?)<\/td>/)?.[1])
  const map = html.match(/<iframe[^>]+src="(https:\/\/www.google.com\/maps\/embed[^"\s]+)/)?.[1]
  const center=map?.match(/!2d([\d.]+)!3d([\d.]+)/)
  const row = { id: `zagzag-${new URL(url).pathname.split('/').filter(Boolean).pop()}`, chain_name: 'ザグザグ', name: name.startsWith('ザグザグ') ? name : `ザグザグ ${name}`, address, phone, hours, lat:null,lng:null,approximateMapCenter:center?{lat:Number(center[2]),lng:Number(center[1])}:null, sourceUrl: url, source: 'zagzag', collectedAt, taxFree: null, coordinateSource:null,coordinateAccuracy:null }
  if (!name || !address) throw Error('Missing name or address')
  return { ...row, channel: 'physical' }
}

export async function main() {
  const args = process.argv.slice(2)
  const out = args.find(x => x.startsWith('--out='))?.slice(6) || 'artifacts/drugstores-zagzag-complete-2026-09-13'
  const offline=args.includes('--offline'),resume=args.includes('--resume')
  const get = await createFetcher(out, offline, resume)
  const urls = new Set(), stores = [], pending = [], failures = [],excluded=[]
  // The unfiltered listing renders no results; discover current prefecture filters.
  let pages = 0, enumerationComplete = false
  const index = await get(base)
  const prefs = [...new Set([...index.html.matchAll(/shops\/\?pref=(\d+)/g)].map(m => m[1]))]
  if (!prefs.length) throw Error('No prefecture filters found')
  enumerationComplete = true
  for (const pref of prefs) for (let p = 1; p <= 100; p++) {
    const url = p === 1 ? `${base}?pref=${pref}` : `${base}page/${p}/?pref=${pref}`
    const { html } = await get(url)
    for (const m of html.matchAll(/href=["']([^"']*\/shops\/(?!page\/)[^"'#?]+\/)["']/g)) {
      const next = new URL(m[1], base)
      if (next.origin === new URL(base).origin && /^\/shops\/[^/]+\/$/.test(next.pathname)) urls.add(next.href)
    }
    pages++
    if (!html.includes(`/page/${p + 1}/`)) break
    if (p === 100) enumerationComplete = false
  }
  if (!urls.size) throw Error('No detail URLs found')
  await fs.writeFile(`${out}/index-urls.json`, JSON.stringify([...urls], null, 2))
  async function save(done = false) {
    await fs.writeFile(`${out}/stores.json`, JSON.stringify(stores, null, 2))
    await fs.writeFile(`${out}/pending-coordinates.json`, JSON.stringify(pending, null, 2))
    await fs.writeFile(`${out}/report.json`, JSON.stringify({ source: 'zagzag', generatedAt: new Date().toISOString(), databaseApplied: false, complete: done, enumerationComplete:enumerationComplete&&done&&failures.length===0, pages, discovered: urls.size, processed: stores.length + pending.length + failures.length+excluded.length, addressTotal: stores.length + pending.length, accepted:stores.length, importEligible: stores.length, pendingCoordinates: pending.length, failures,excluded, coordinateNote: 'Only official embed entity markers with matching store name and phone are import eligible; viewport centers rejected.' }, null, 2))
  }
  for (const url of urls) {
    try {
      const { html, collectedAt } = await get(url)
      const row = parseZagzag(html, url, collectedAt)
      try{stores.push(validateStore({...row,...await getOfficialEmbedMarker(html,row,out,{offline,resume}),coordinateSource:'official embedded map entity',coordinateAccuracy:'store-marker'}))}
      catch(e){pending.push({...row,reason:e.message})}
    } catch (e) { (/active retail/.test(e.message)?excluded:failures).push({ sourceUrl: url, reason: e.message }) }
    if ((stores.length + pending.length + failures.length+excluded.length) % 25 === 0) { await save(); console.log(`ZAGZAG ${stores.length + pending.length + failures.length+excluded.length}/${urls.size}, accepted ${stores.length}`) }
  }
  await save(true)
  await fs.writeFile(`${out}/import.sql`, buildImportSql([], stores))
  console.log(JSON.stringify({ discovered: urls.size, addressTotal: stores.length + pending.length, importEligible: stores.length, pendingCoordinates: pending.length, failures: failures.length }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
