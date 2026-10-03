import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseWelciaStore,buildImportSql} from './crawl-drugstores.mjs'

export function parseWelciaRetail(row,collectedAt) {
  const details = (row.detail_groups || []).flatMap(g=>(g.texts || []).flatMap(t=>t.details || []))
  assert.equal(details.find(d=>d.code==='00002')?.value,'ドラッグストア','Not explicitly retail')
  assert(!/閉店|休業中|開店予定/.test(row.name),'Closure or future notice')
  return validateStore({...parseWelciaStore(row,collectedAt),coordinateDatum:'wgs84',
    coordinateEvidence:'Official store API coordinates requested with datum=wgs84'})
}
async function main() {
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-welcia-2026-10-03'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const stores=[],excluded=[],seen=new Set()
  let expected
  for(let offset=0;;offset+=500) {
    const url=`https://store.welcia.co.jp/welcia/api/proxy2/shop/list?add=detail_group&datum=wgs84&limit=500&offset=${offset}&ex-code=only.prior&ignore-i18n=true`
    const saved=await get(url),data=JSON.parse(saved.html)
    assert(Array.isArray(data.items)&&Number.isInteger(data.count?.total),'Invalid directory response')
    expected??=data.count.total
    assert.equal(data.count.total,expected,'Directory changed during pagination')
    for(const row of data.items) {
      assert(!seen.has(row.code),'Repeated official store code');seen.add(row.code)
      try {stores.push(parseWelciaRetail(row,saved.collectedAt))}
      catch(e) {excluded.push({id:row.code,name:row.name,reason:e.message})}
    }
    if(seen.size>=expected)break
    assert(data.items.length>0,'Truncated pagination')
  }
  assert.equal(seen.size,expected,'Incomplete official directory')
  const report={generatedAt:new Date().toISOString(),expected,discovered:seen.size,accepted:stores.length,excluded:excluded.length,
    enumerationComplete:true,coordinateDatum:'wgs84',applied:false,brands:Object.fromEntries([...new Set(stores.map(s=>s.chain_name))].sort().map(n=>[n,stores.filter(s=>s.chain_name===n).length]))}
  for(const [file,data] of Object.entries({'stores.json':stores,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores))
  console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
