import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'
import {validGtin} from './import-new-products.mjs'
import {databaseProcess} from './sync-sundrug.mjs'

const origin = 'https://www.earth.jp'
const plain = s => s.replace(/<[^>]*>/g,' ').replaceAll('&amp;','&').replaceAll('&nbsp;',' ').replaceAll('&quot;','"').replace(/\s+/g,' ').trim()
export function parseEarthProduct(html, sourceUrl) {
  assert(new URL(sourceUrl).origin === origin && /^\/products\/[^/]+\/index\.html$/.test(new URL(sourceUrl).pathname), 'Invalid Earth product URL')
  const name = plain(html.match(/<h1 class="product2-head--ttl">([\s\S]*?)<\/h1>/)?.[1] || '')
  const imageUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || ''
  const shop = html.match(/<div class="product2-info--main-shop">([\s\S]*?)<!-- 製品DB連携エリア - オンラインストア END -->/)?.[1] || ''
  const codes = [...new Set([...shop.matchAll(/href="https:\/\/item\.rakuten\.co\.jp\/rakuten24\/(\d{13})\/"/g)].map(m=>m[1]))]
  assert(name && codes.length === 1 && validGtin(codes[0]), 'No unambiguous current-product retail JAN')
  const barcode = codes[0], image = new URL(imageUrl)
  assert(image.origin === origin && image.pathname.startsWith(new URL(sourceUrl).pathname.replace('index.html','images/')) && new RegExp(`(?:^|[^0-9])${barcode}(?:[^0-9]|$)`).test(image.pathname), 'Main image does not corroborate current-product JAN')
  const pack = plain(html.match(/<th>内容量<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/)?.[1] || '')
  return {barcode,name,pack,brand:'',category:'',description:'',imageUrl,catalogSource:'earth',sourceUrl,
    evidenceType:'official-main-purchase-link-and-matching-main-image'}
}

async function main() {
  const out = process.argv.find(a=>a.startsWith('--out='))?.slice(6) || 'artifacts/products-round4-2026-10-22'
  const get = await createFetcher(`${out}/earth-cache`, process.argv.includes('--offline'), true)
  const existing = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL,
    '\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(lpad(barcode,14,\'0\')) from public.products;')))
  const sitemap = (await get(`${origin}/sitemap.xml`)).html
  const urls = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).filter(u=>u.startsWith(`${origin}/products/`) && u.endsWith('/index.html')))]
  assert(urls.length > 100, 'Unexpected Earth sitemap')
  const rows = new Map(), excluded = [], failures = []
  let next = 0, attempted = 0, blocked = false
  async function save() {
    const all = [...rows.values()], fresh = all.filter(r=>!existing.has(r.barcode.padStart(14,'0')))
    await writeFile(`${out}/earth.json`, JSON.stringify(fresh,null,2))
    await writeFile(`${out}/earth-report.json`,JSON.stringify({generatedAt:new Date().toISOString(),
      sitemapUrl:`${origin}/sitemap.xml`, productUrls:urls.length, attempted, verifiedUniqueGtins:all.length,
      newProducts:fresh.length, excluded, failures, fetchedAll:attempted===urls.length&&!failures.length,
      complete:attempted===urls.length&&!failures.length&&!excluded.length, databaseApplied:false,
      policy:'Current product main purchase JAN and main image must agree; no recommendation-area identities'},null,2))
  }
  await Promise.all(Array.from({length:2},async()=>{
    while(next<urls.length&&!blocked) {
      const url=urls[next++]
      try {
        const html=(await get(url)).html
        try {const row=parseEarthProduct(html,url);rows.set(row.barcode.padStart(14,'0'),row)}
        catch(e){excluded.push({url,reason:e.message})}
      }catch(e){failures.push({url,reason:e.message});if(/429|403/.test(e.message))blocked=true}
      attempted++
      if(attempted%25===0){await save();console.log(`Earth ${attempted}/${urls.length}: ${rows.size} verified GTINs`)}
    }
  }))
  await save()
  if(attempted!==urls.length||failures.length)process.exitCode=1
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
