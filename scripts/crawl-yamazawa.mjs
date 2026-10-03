import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'
import {getOfficialEmbedMarker} from './official-embed-marker.mjs'
const source='https://www.yamazawa-drg.co.jp/shop/'
const clean=s=>(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
export function parseYam(html,url,collectedAt){
  const name=clean(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1])
  const fields=new Map([...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map(([,k,v])=>[clean(k),clean(v)]))
  const address=(fields.get('住所')||'').replace(/^〒\s*[\d-]+\s*/,'')
  const row={id:'yamazawa-'+new URL(url).pathname.split('/').filter(Boolean).pop(),name,chain_name:'ヤマザワ薬品',address,phone:fields.get('TEL')||'',hours:fields.get('営業時間')||'',sourceUrl:url,collectedAt,lat:null,lng:null}
  if(!name||!address)return {pending:{...row,reason:'Missing official store identity/address'}}
  if(/調剤|薬局/.test(name))return {excluded:{...row,reason:'Dispensing-only store'}}
  return {pending:{...row,reason:'Reliable official map entity coordinates required; viewport center rejected'}}
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-yamazawa-2026-10-03'
  const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume'),get=await createFetcher(out,offline,resume)
  const pages=[source],seen=new Set(),urls=new Set()
  while(pages.length){
    const u=pages.shift();if(seen.has(u))continue;seen.add(u);assert(seen.size<30,'Unexpected pagination growth')
    const page=await get(u)
    for(const [,href] of page.html.matchAll(/href="(https:\/\/www\.yamazawa-drg\.co\.jp\/shop\/[^"#]+)"/g)){
      const parsed=new URL(href)
      if(/^\/shop\/page\/\d+\/?$/.test(parsed.pathname)){if(!seen.has(href)&&!pages.includes(href))pages.push(href)}
      else if(/^\/shop\/[^/]+\/?$/.test(parsed.pathname))urls.add(href)
    }
  }
  assert(urls.size>0)
  const stores=[],pending=[],excluded=[],failures=[]
  for(const u of urls){
    try{
      const d=await get(u),x=parseYam(d.html,u,d.collectedAt)
      if(x.excluded){excluded.push(x.excluded);continue}
      const {reason,...row}=x.pending
      if(!row.name||!row.address){pending.push(x.pending);continue}
      try{stores.push(validateStore({...row,...await getOfficialEmbedMarker(d.html,row,out,{offline,resume})}))}
      catch(e){pending.push({...row,reason:e.message})}
    }catch(e){failures.push({url:u,reason:e.message})}
    const done=stores.length+pending.length+excluded.length+failures.length
    if(done%15===0)console.log(`Yamazawa ${done}/${urls.size}: accepted ${stores.length}`)
  }
  const report={generatedAt:new Date().toISOString(),source,pages:[...seen],discovered:urls.size,accepted:stores.length,pending:pending.length,excluded:excluded.length,failures,enumerationComplete:failures.length===0,applied:false}
  for(const [f,v] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${f}`,JSON.stringify(v,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
