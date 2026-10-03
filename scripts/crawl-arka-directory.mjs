import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'
const root='https://arka.co.jp/',clean=s=>(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
export function parseArka(h,url,collectedAt){
  const field=label=>clean(h.match(new RegExp(`<dt[^>]*>\\s*<span>${label}</span>[\\s\\S]*?<dd><p>([\\s\\S]*?)</p>`))?.[1])
  const name=field('店舗名'),address=field('住所').replace(/^〒[\d-]+\s*/,'')
  const id=new URL(url).searchParams.get('shop_id'),row={id:'arka-'+id,name,chain_name:'アルカドラッグ',address,phone:field('TEL'),hours:field('営業時間'),sourceUrl:url,collectedAt}
  if(name&&!/ドラッグ/.test(name))return {excluded:{...row,reason:'Official dispensing-only branch'}}
  const c=h.match(/var pinLatlng\s*=\s*new google\.maps\.LatLng\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)
  if(!id||!name||!address||!c||!/position:\s*pinLatlng/.test(h))return {pending:{...row,reason:'Missing retail identity/address/explicit marker'}}
  return {store:validateStore({...row,lat:Number(c[1]),lng:Number(c[2]),coordinateEvidence:'Official detail marker position=pinLatlng'})}
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-arka-2026-10-03'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume')),s=await get(root+'search.php')
  const city=[...new Set([...s.html.matchAll(/href="(list\.php\?ct=[^"]+)"/g)].map(m=>new URL(m[1],root).href))],urls=new Set()
  for(const u of city)for(const [,x] of (await get(u)).html.matchAll(/href="(detail\.php\?shop_id=[cd]\d+)"/g))urls.add(new URL(x,root).href)
  const stores=[],pending=[],excluded=[]
  for(const u of urls){const d=await get(u),x=parseArka(d.html,u,d.collectedAt);if(x.store)stores.push(x.store);if(x.pending)pending.push(x.pending);if(x.excluded)excluded.push(x.excluded)}
  const report={generatedAt:new Date().toISOString(),source:root+'search.php',cityPages:city.length,discovered:urls.size,accepted:stores.length,pending:pending.length,excluded:excluded.length,enumerationComplete:true,applied:false}
  for(const [f,v] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${f}`,JSON.stringify(v,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
