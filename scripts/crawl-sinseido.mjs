import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createFetcher, validateStore } from './crawl-national-stores.mjs'
import { buildImportSql } from './crawl-drugstores.mjs'

const base = 'https://map.sinseido-co.jp'
const api = 'https://g9ey9rioe.api.hp.can-ly.com/v2/companies/927/shops/search?sort=alphabetical'
export function parseSinseido(s, collectedAt) {
  if (s.businessStatus !== 'OPEN' || s.baseInfo?.baseInfo?.publishStatus?.isPublished === false) throw Error('Closed or unpublished')
  if (s.selectBrand?.selectBrand?.selected?.item?.brand?.label !== 'ドラッグストア') throw Error('Dispensing-only pharmacy')
  return validateStore({ id: `sinseido-${s.storeCode}`, name: s.nameKanji, chain_name: 'ドラッグ新生堂', address: s.address,
    lat: Number(s.latitude), lng: Number(s.longitude), phone: s.phoneNumber || '',
    hours: (s.businessHours || []).map(h => `${h.name} ${h.openTime?.slice(0,5) || '休業'}${h.closeTime ? '–' + h.closeTime.slice(0,5) : ''}`).join('; '),
    taxFree: null, sourceStoreCode: s.storeCode, sourceUrl: `${base}/detail/${s.storeCode}/`, sourceApiUrl: api, collectedAt })
}

async function main() {
  const out = process.argv.find(x=>x.startsWith('--out='))?.slice(6) || 'artifacts/drugstores-sinseido-2026-09-13'
  const get = await createFetcher(out, process.argv.includes('--offline'), process.argv.includes('--resume'))
  await get(`${base}/all/`)
  const saved = await get(api), data = JSON.parse(saved.html)
  assert(Array.isArray(data.shops) && data.shops.length > 0, 'Empty official directory')
  assert.equal(new Set(data.shops.map(s=>s.storeCode)).size, data.shops.length, 'Duplicate source codes')
  assert(data.maxPage <= 1, 'Unexpected pagination; do not mark complete')
  const stores = [], excluded = []
  for (const s of data.shops) {
    try { stores.push(parseSinseido(s, saved.collectedAt)) } catch(e) { excluded.push({id:s.storeCode,name:s.nameKanji,reason:e.message}) }
  }
  assert(stores.length > 0)
  assert.throws(()=>parseSinseido({businessStatus:'OPEN',selectBrand:{selectBrand:{selected:{item:{brand:{label:'調剤薬局'}}}}}}), /Dispensing-only/)
  const report = {collectedAt:saved.collectedAt,source:api,discovered:data.shops.length,accepted:stores.length,excluded,enumerationComplete:true,
    note:'Official all-shops endpoint returns maxPage=0,totalCount=0 despite populated shops; preserved raw response in cache. Only explicit drugstore category accepted.'}
  await writeFile(`${out}/stores.json`,JSON.stringify(stores,null,2))
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores))
  console.log(JSON.stringify({out,discovered:data.shops.length,accepted:stores.length,excluded:excluded.length}))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e);process.exitCode=1})
