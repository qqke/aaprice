import fs from 'node:fs/promises'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseMoriDetail} from './parse-mori-details.mjs'
import {getOfficialEmbedMarker} from './official-embed-marker.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-mori-2026-10-03'
const get = await createFetcher(out, process.argv.includes('--offline'), process.argv.includes('--resume'))
const page = await get('https://www.doramori.co.jp/store/')
const urls = [...new Set([...page.html.matchAll(/<h4 class="name">\s*<a href="([^"]+)"/g)].map(m => m[1]))]
if (!urls.length) throw Error('No official store detail links')
await fs.writeFile(`${out}/index-urls.json`, JSON.stringify(urls, null, 2))
await fs.writeFile(`${out}/report.json`, JSON.stringify({ source: 'drugstore-mori', sourceUrl: page.url, collectedAt: page.collectedAt, discoveredDetailUrls: urls.length, status: 'See report-details.json for detail collection results' }, null, 2))
const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume')
const stores=[],pending=[],failures=[]
async function save(complete){
  const report={source:'drugstore-mori',sourceUrl:page.url,generatedAt:new Date().toISOString(),discovered:urls.length,processed:stores.length+pending.length+failures.length,accepted:stores.length,pending:pending.length,failures,enumerationComplete:complete&&failures.length===0,databaseApplied:false}
  for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'report.json':report}))await fs.writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
  await fs.writeFile(`${out}/import.sql`,buildImportSql([],stores))
}
for(const url of urls){
  try{
    const detail=await get(url),row=parseMoriDetail(detail.html,url,detail.collectedAt)
    row.id=`mori-${new URL(url).pathname.split('/').filter(Boolean).pop()}`
    row.name=row.name.startsWith('ドラッグストアモリ')?row.name:`ドラッグストアモリ ${row.name}`
    if(/閉店|休業|オープン予定/.test(row.name)){pending.push({...row,reason:'Closure/future notice'});continue}
    try{stores.push(validateStore({...row,...await getOfficialEmbedMarker(detail.html,row,out,{offline,resume})}))}
    catch(e){pending.push({...row,reason:e.message})}
  }catch(e){failures.push({url,reason:e.message})}
  if((stores.length+pending.length+failures.length)%20===0){await save(false);console.log(`Mori ${stores.length+pending.length+failures.length}/${urls.length}: accepted ${stores.length}, pending ${pending.length}, failures ${failures.length}`)}
}
await save(true)
console.log(JSON.stringify({out,discovered:urls.length,accepted:stores.length,pending:pending.length,failures:failures.length}))
