import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createFetcher, directorySources, parseCanlyStore } from './crawl-national-stores.mjs'
import { buildImportSql } from './crawl-drugstores.mjs'

const out = 'artifacts/drugstores-akakabe-2026-09-13'
const base = 'https://tenpo.akakabe.com'
const api = 'https://g9ey9rioe.api.hp.can-ly.com/v2/companies/842/shops/search?sort=alphabetical'
directorySources.akakabe = {name:'アカカベ',base,api}
const get = await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
await get(`${base}/all/`)
const saved = await get(api), data = JSON.parse(saved.html)
assert(Array.isArray(data.shops) && data.shops.length > 0)
assert(data.maxPage <= 1,'Unexpected pagination')
assert.equal(new Set(data.shops.map(s=>s.storeCode)).size,data.shops.length)
const stores = [], excluded = []
for (const row of data.shops) {
  try { stores.push({...parseCanlyStore('akakabe',row,saved.collectedAt),sourceUrl:`${base}/detail/${row.storeCode}/`}) }
  catch(e) { excluded.push({id:row.storeCode,name:row.nameKanji,reason:e.message}) }
}
assert(stores.length > 0)
assert.equal(stores.length + excluded.length,data.shops.length)
await writeFile(`${out}/stores.json`,JSON.stringify(stores,null,2))
await writeFile(`${out}/report.json`,JSON.stringify({source:api,collectedAt:saved.collectedAt,discovered:data.shops.length,accepted:stores.length,excluded,enumerationComplete:true},null,2))
await writeFile(`${out}/import.sql`,buildImportSql([],stores))
console.log(JSON.stringify({out,discovered:data.shops.length,accepted:stores.length,excluded:excluded.length}))
