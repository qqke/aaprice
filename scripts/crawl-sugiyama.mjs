import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher, validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'

const clean = s => (s || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
export function parseCoordinateLabel(html) {
  const map = html.match(/<iframe[^>]*src="(https:\/\/www\.google\.com\/maps\/embed\?[^"<>]+)"/)?.[1]
  assert(map, 'No official embedded map')
  const labels = [...map.matchAll(/!2z([^!&]+)/g)].map(([,value]) => Buffer.from(decodeURIComponent(value),'base64url').toString('utf8'))
  for (const label of labels) {
    const m = label.match(/^(\d+)°(\d+)'([\d.]+)"N\s+(\d+)°(\d+)'([\d.]+)"E$/)
    if (!m) continue
    assert([m[2],m[3],m[5],m[6]].every(x=>Number(x)>=0 && Number(x)<60), 'Invalid DMS minutes or seconds')
    return {lat:Number(m[1])+Number(m[2])/60+Number(m[3])/3600,
      lng:Number(m[4])+Number(m[5])/60+Number(m[6])/3600,
      coordinateEvidence:'Official map coordinate label (DMS), not viewport center', coordinateLabel:label}
  }
  throw Error('Embedded map has no explicit coordinate label; viewport center rejected')
}
export function parseSugiyama(html, sourceUrl, collectedAt) {
  const main = html.replace(/<!--[\s\S]*?-->/g,'').match(/<main>([\s\S]*?)<\/main>/)?.[1]
  assert(main, 'Missing store content')
  const brand = clean(main.match(/<span class="layTxtC">([\s\S]*?)<\/span>/)?.[1])
  const shortName = clean(main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1])
  assert(brand && shortName, 'Missing store name')
  const fields = new Map([...main.matchAll(/<tr>\s*<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)].map(([,k,v])=>[clean(k),clean(v)]))
  const pref = {aichi:'愛知県',gifu:'岐阜県',mie:'三重県'}[new URL(sourceUrl).pathname.split('/')[2]]
  assert(pref, 'Unknown official prefecture category')
  let address = (fields.get('住所') || '').replace(/^〒[\d-]+\s*/,'')
  assert(address && /市|郡|町|村/.test(address), 'Missing store address')
  if (!/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(address)) address = pref + address
  const code = sourceUrl.match(/\/(seq|entry)-(\d+)\.html$/)
  assert(code, 'Unknown store URL identity')
  const row = {id:`sugiyama-${code[1]}-${code[2]}`, name:`${brand} ${shortName}`, chain_name:brand, address,
    addressEvidence:'Official detail address plus official prefecture URL category', phone:fields.get('電話番号') || '',
    hours:clean(main.match(/<dt>店舗営業時間<\/dt>\s*<dd>([\s\S]*?)<\/dd>/)?.[1]), taxFree:null, sourceUrl,collectedAt}
  if (/調剤/.test(brand)) return {excluded:{...row,reason:'Dispensing-only brand'}}
  if (!['ドラッグスギヤマ','スギヤマ薬品'].includes(brand)) return {pending:{...row,reason:'Unrecognized retail brand'}}
  if (/近日オープン|オープン予定/.test(row.hours)) return {excluded:{...row,reason:'Not yet open'}}
  if (/閉店|休業|オープン予定/.test(clean(main).replace(/定休日は休業/g,''))) return {pending:{...row,reason:'Closure/opening notice requires review'}}
  try { return {store:validateStore({...row,...parseCoordinateLabel(main)})} }
  catch(e) { return {pending:{...row,reason:e.message}} }
}
async function main() {
  const out = process.argv.find(x=>x.startsWith('--out='))?.slice(6) || 'artifacts/drugstores-sugiyama-2026-09-13'
  const get = await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const source = 'https://sugiyama-club.jp/shop/list.html'
  const page = await get(source), html = page.html.replace(/<!--[\s\S]*?-->/g,'')
  const urls = [...new Set([...html.matchAll(/href="([^"]+)" class="shopSimplicityLink"/g)].map(m=>m[1]))]
  assert(urls.length>0,'Empty directory')
  assert(!/href="[^"]*(?:\/page\/\d|[?&]page=\d)/.test(html),'Unexpected pagination; extend before claiming completeness')
  const stores=[],pending=[],excluded=[],failures=[]
  for (const url of urls) {
    assert(url.startsWith('https://sugiyama-club.jp/shop/'),'Unexpected detail origin')
    try {
      const detail = await get(url), parsed = parseSugiyama(detail.html,url,detail.collectedAt)
      if (parsed.store) stores.push(parsed.store)
      if (parsed.pending) pending.push(parsed.pending)
      if (parsed.excluded) excluded.push(parsed.excluded)
    } catch(e) { failures.push({url,reason:e.message}) }
    const done=stores.length+pending.length+excluded.length+failures.length
    if(done%10===0 || done===urls.length) console.log(`Sugiyama ${done}/${urls.length}: accepted ${stores.length}, pending ${pending.length}, excluded ${excluded.length}, failures ${failures.length}`)
  }
  assert.equal(new Set(stores.map(s=>s.id)).size,stores.length,'Duplicate store IDs')
  const report={generatedAt:new Date().toISOString(),source,listCollectedAt:page.collectedAt,discovered:urls.length,
    accepted:stores.length,pending:pending.length,excluded:excluded.length,failures,enumerationComplete:failures.length===0,applied:false}
  for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report})) await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores))
  console.log(JSON.stringify(report))
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e);process.exitCode=1})
