import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'

const base='https://store.seims.co.jp',source=base+'/prefecture/'
export function seimsUrl(fields){
  return base+'/api/point/?'+new URLSearchParams({backend_order:encodeURI('{}'),backend_filters:encodeURI('{}'),fields:Buffer.from(encodeURI(fields)).toString('base64')})
}
export function parseSeimsStore(identity,detail,collectedAt){
  assert.equal(identity.key,detail.key,'Identity mismatch')
  assert.equal(identity.latitude,detail.latitude,'Coordinates changed between requests')
  assert.equal(identity.longitude,detail.longitude,'Coordinates changed between requests')
  const e=detail.extra_fields
  assert(e?.['ドラッグストア']==='1','Not explicitly classified as retail drugstore')
  assert(e['ｶﾝﾊﾞﾝ種類（屋号）']!=='2','Yutaka already covered through its own official directory')
  assert(!/閉店|休業|予定|近日/.test(identity.name),'Closure or future opening notice')
  const chain=detail.marker?.ja?.name
  assert(chain && chain!=='その他','Unknown group brand')
  return validateStore({id:`seims-group-${identity.key}`,name:identity.name,chain_name:chain,address:identity.address,
    city:e['市区町村①']||'',lat:identity.latitude,lng:identity.longitude,phone:e['電話番号']||'',hours:e['営業時間（ドラッグストア）']||'',
    taxFree:e['免税店']==='1'?true:null,sourceUrl:source,sourceApiUrl:seimsUrl(''),sourceStoreCode:identity.key,collectedAt,
    coordinateEvidence:'Official GOGA store directory latitude/longitude'})
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-seims-complete-2026-09-13'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  await get(source)
  const identity=await get(seimsUrl('key,name,address,latitude,longitude')),details=await get(seimsUrl(''))
  const names=JSON.parse(identity.html),data=JSON.parse(details.html)
  assert.equal(names.items.length,names.total,'Truncated identity result')
  assert.equal(data.items.length,data.total,'Truncated detail result')
  assert.equal(names.total,data.total,'Directory changed between requests')
  const byId=new Map(names.items.map(s=>[s.key,s]))
  assert.equal(byId.size,names.total,'Duplicate identity keys')
  assert.equal(new Set(data.items.map(s=>s.key)).size,data.total,'Duplicate detail keys')
  const stores=[],excluded=[]
  for(const row of data.items){
    assert(byId.has(row.key),'Missing identity; cannot merge snapshots')
    try{stores.push(parseSeimsStore(byId.get(row.key),row,details.collectedAt))}
    catch(e){excluded.push({id:row.key,name:byId.get(row.key).name,reason:e.message})}
  }
  const report={generatedAt:new Date().toISOString(),source,identityCollectedAt:identity.collectedAt,collectedAt:details.collectedAt,discovered:data.total,
    accepted:stores.length,excluded:excluded.length,enumerationComplete:true,applied:false,
    brands:Object.fromEntries([...new Set(stores.map(s=>s.chain_name))].map(name=>[name,stores.filter(s=>s.chain_name===name).length]))}
  for(const [file,value] of Object.entries({'stores.json':stores,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
