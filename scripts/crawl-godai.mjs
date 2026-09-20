import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createFetcher, validateStore } from './crawl-national-stores.mjs'
import { buildImportSql } from './crawl-drugstores.mjs'

const out = 'artifacts/drugstores-godai-2026-09-13'
const api = 'https://www.godai.net/wp/wp-admin/admin-ajax.php?action=godai-shop-info_gettenpo'
const get = await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
await get('https://www.godai.net/store/')
const saved = await get(api), data = JSON.parse(saved.html)
assert(data.ret && Array.isArray(data.lst) && data.lst.length > 0)
assert.equal(new Set(data.lst.map(s=>s['番号'])).size,data.lst.length)
const stores = [], excluded = []
for (const row of data.lst) {
  try {
    assert.equal(row['区分'],'ゴダイドラッグ','Not a retail drugstore')
    assert(!/閉店|休業中/.test(row['名称']),'Closure notice')
    stores.push(validateStore({id:`godai-${row['番号']}`,name:row['名称'],chain_name:'ゴダイドラッグ',
      address:row['都道府県']+row['住所'],lat:Number(row['緯度']),lng:Number(row['経度']),phone:row['電話番号']||'',hours:row['営業時間']||'',
      taxFree:/免税/.test(row['設備アイコン']||'') ? true : null,sourceUrl:'https://www.godai.net/store/',sourceStoreCode:row['番号'],sourceApiUrl:api,collectedAt:saved.collectedAt}))
  } catch(e) {excluded.push({id:row['番号'],name:row['名称'],category:row['区分'],reason:e.message})}
}
assert(stores.length>0)
await writeFile(`${out}/stores.json`,JSON.stringify(stores,null,2))
await writeFile(`${out}/report.json`,JSON.stringify({source:api,collectedAt:saved.collectedAt,discovered:data.lst.length,accepted:stores.length,excluded,enumerationComplete:true,
  note:'Official public map endpoint. Coordinates omitted from request to retrieve all stores, as supplying coordinates limits nearby results.'},null,2))
await writeFile(`${out}/import.sql`,buildImportSql([],stores))
console.log(JSON.stringify({out,discovered:data.lst.length,accepted:stores.length,excluded:excluded.length}))
