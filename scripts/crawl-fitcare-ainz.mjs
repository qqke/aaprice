import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'

const clean=s=>(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const source='https://www.kamegaya.co.jp/cgi-bin/cl/public/index.cgi/kmg/search/index'
export function parseFitcare(html,url,collectedAt){
  html=html.replace(/<!--[\s\S]*?-->/g,'')
  const shortName=clean(html.match(/<div class="shopNameInner">[\s\S]*?<h3>([\s\S]*?)<\/h3>/)?.[1])
  const category=new URL(url).pathname.split('/')[2]
  const brand={fitCareDepot:'Fit Care DEPOT',fitCareExpress:'Fit Care Express',fitCareMart:'Fit Care MART'}[category]
  const info=html.match(/<div class="shopInfo">([\s\S]*?)<\/div>/)?.[1]||''
  const fields=[...info.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>clean(m[1]))
  let address=fields[1]||''
  if(/^(横浜市|川崎市|鎌倉市|相模原市|海老名市)/.test(address))address='神奈川県'+address
  if(/^(町田市|大田区|世田谷区)/.test(address))address='東京都'+address
  const id=url.match(/entry(\d+)\.html$/)?.[1]
  const row={id:`kamegaya-${id}`,name:`${brand||category} ${shortName}`,chain_name:brand||category,address,
    addressEvidence:'Official address; prefecture resolved from named municipality where omitted',sourceUrl:url,collectedAt,taxFree:null}
  const retail=/<h4[^>]*>ドラッグストア<\/h4>/.test(html)
  if(!brand||(!retail&&/<h4[^>]*>調剤薬局<\/h4>/.test(html))||/調剤|薬局/.test(shortName))return {excluded:{...row,reason:'Not a retail Fit Care store'}}
  const dept=(retail?html.match(/<h4[^>]*>ドラッグストア<\/h4>([\s\S]*?)<\/ul>/):html.match(/<div class="departmentInner">([\s\S]*?)<\/ul>/))?.[1]||''
  row.phone=clean(dept.match(/<li class="tel">([\s\S]*?)<\/li>/)?.[1]).replace(/^TEL\s*/,'')
  row.hours=clean(dept.match(/<li>【営業時間】([\s\S]*?)<\/li>/)?.[1])
  const coord=html.match(/var latlng\s*=\s*new google\.maps\.LatLng\(\s*([\d.]+),\s*([\d.]+)\)/)
  if(!id||!shortName||!/^(東京都|神奈川県)/.test(address)||!coord||!/position:\s*latlng/.test(html)||!/new google\.maps\.Marker\(markerOptions\)/.test(html))return {pending:{...row,reason:'Incomplete identity/address or explicit marker'}}
  if(/閉店|休業|予定|近日/.test(shortName))return {pending:{...row,reason:'Closure/future notice'}}
  return {store:validateStore({...row,lat:Number(coord[1]),lng:Number(coord[2]),coordinateEvidence:'Official markerOptions.position=latlng'})}
}
export function parseAinz(html,collectedAt){
  const rows=[]
  for(const [,block] of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<li class="wl-shop-list__item"[^>]*>([\s\S]*?)<\/li>/g)){
    const href=block.match(/href="(\/blogs\/shop\/[^"<>]+)"/)?.[1]
    const name=clean(block.match(/<h4 class="wl-shop-list__item-title">([\s\S]*?)<\/h4>/)?.[1])
    const values=[...block.matchAll(/<div class="wl-shop-list__item-data__value[^"<>]*">([\s\S]*?)<\/div>/g)].map(m=>clean(m[1]))
    assert(href&&name&&values.length>=2,'Incomplete official Ainz listing')
    rows.push({id:`ainz-${href.split('/').pop()}`,name,chain_name:'アインズ＆トルペ',address:values[0],phone:values[1],hours:values[2]||'',
      lat:null,lng:null,sourceUrl:new URL(href,'https://ainz-tulpe.jp').href,sourceListUrl:'https://ainz-tulpe.jp/blogs/shop',collectedAt,
      reason:'Official list provides address/phone/hours but no coordinates; location verification pending'})
  }
  assert(rows.length>0)
  assert.equal(new Set(rows.map(s=>s.id)).size,rows.length,'Duplicate Ainz IDs')
  return rows
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-fitcare-ainz-2026-09-13'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const page=await get(source),expected=Number(page.html.match(/resultText">(\d+)件/)?.[1])
  const urls=[...new Set([...page.html.matchAll(/href="(https:\/\/www\.kamegaya\.co\.jp\/search\/[^"<>]+\/entry\d+\.html)"/g)].map(m=>m[1]))]
  assert.equal(urls.length,expected,'Incomplete Fit Care enumeration')
  const stores=[],pending=[],excluded=[],failures=[]
  for(const url of urls){
    try{const p=await get(url),r=parseFitcare(p.html,url,p.collectedAt);if(r.store)stores.push(r.store);if(r.pending)pending.push(r.pending);if(r.excluded)excluded.push(r.excluded)}
    catch(e){failures.push({url,reason:e.message})}
    const done=stores.length+pending.length+excluded.length+failures.length
    if(done%15===0)console.log(`Fit Care ${done}/${urls.length}`)
  }
  const ainzPage=await get('https://ainz-tulpe.jp/blogs/shop'),ainz=parseAinz(ainzPage.html,ainzPage.collectedAt)
  const report={generatedAt:new Date().toISOString(),sources:{kamegaya:{expected,discovered:urls.length,accepted:stores.length,pending:pending.length,excluded:excluded.length,failures,enumerationComplete:failures.length===0},
    ainz:{discovered:ainz.length,accepted:0,pending:ainz.length,enumerationComplete:true,scope:'Complete official shop list, without fetching every detail page'}},applied:false}
  pending.push(...ainz)
  for(const [file,value] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
