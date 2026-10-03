import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {getOfficialEmbedMarker} from './official-embed-marker.mjs'

const clean=s=>String(s||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;|&#038;/g,'&').replace(/&minus;/g,'−').replace(/\s+/g,' ').trim()
const norm=s=>clean(s).normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')
const id=(brand,name)=>`${brand}-${createHash('sha256').update(norm(name)).digest('hex').slice(0,16)}`
const field=(html,label)=>clean(html.match(new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`))?.[1])
const phone=s=>clean(s).match(/(?:0\d{1,4})[-－]\d{1,4}[-－]\d{3,4}/)?.[0]||''
const address=s=>clean(s).replace(/^日本、\s*/,'').replace(/^〒\s*\d{3}-?\d{4}\s*/,'')
const attr=(s,key)=>s.match(new RegExp(`${key}=['"]([^'"]*)['"]`))?.[1]||''
export function parseBuildingMarker(mapHtml,embedUrl,row){
 const feature=decodeURIComponent(embedUrl).match(/!1s(0x[\da-f]+:0x[\da-f]+)/i)?.[1]
 assert(feature,'No official feature ID')
 const payload=mapHtml.match(/initEmbed\((\[[\s\S]*?\])\);/)?.[1],entities=[]
 assert(payload,'No embedded entity payload')
 function visit(v){if(!Array.isArray(v))return;if(Array.isArray(v[0])&&v[0][0]===feature)entities.push(v);for(const i of v)visit(i)}
 visit(JSON.parse(payload))
 const canonical=s=>address(s).normalize('NFKC').replace(/[\s]/g,'').replace(/[−ー－]/g,'-').replace(/丁目|番地?|-?号$/g,'-').replace(/-$/,'')
 const matches=entities.filter(e=>e.includes('建造物')&&canonical(e[0][1])===canonical(row.address))
 assert.equal(matches.length,1,'No unique building marker matching official feature ID and full street address')
 const entity=matches[0]
 assert(Array.isArray(entity[0][2])&&entity[0][2].length===2&&entity[0][2].every(Number.isFinite))
 return {lat:entity[0][2][0],lng:entity[0][2][1],coordinateEvidence:'Official embedded building marker feature ID and exact full street address matched; no viewport or mall coordinate used',coordinateEntityId:feature,coordinateSourceUrl:embedUrl}
}

export function parseNishiichi(html,map,sourceUrl,collectedAt){
 const markers=[...map.matchAll(/name:\s*'([^']+)'\s*,\s*lat:\s*([\d.]+)\s*,\s*lng:\s*([\d.]+)/g)].map(m=>({name:clean(m[1]),lat:Number(m[2]),lng:Number(m[3])}))
 assert(markers.length>0,'Official markerData array not found')
 return [...html.split(/<div class="\s*storeBox[^>]*>/).slice(1)].map(block=>{
  const name=clean(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]),marker=markers.find(x=>norm(x.name)===norm(name))
  assert(name,'Missing store name')
  return {id:id('nishiichi',name),name,chain_name:'ニシイチドラッグ',address:'兵庫県'+address(field(block,'住所')),phone:phone(field(block,'ドラッグ')||field(block,'TEL')),hours:field(block,'営業時間'),sourceUrl,collectedAt,retail:/alt="ドラッグ部門"|CVS部門/.test(block),...(marker?{lat:marker.lat,lng:marker.lng,coordinateEvidence:'Official markerData map marker matched exact branch name',coordinateSourceUrl:'https://nishiichi.co/_templates/nishiichi02/js/map.js'}:{reason:'No matching official branch marker'})}
 })
}
export function parseNishimoto(html,sourceUrl,collectedAt){
 assert(/地域密着型ドラッグストア/.test(html),'Not the retail drugstore directory')
 return [...html.matchAll(/<poi\s+([^>]+)>/g)].map(([,a])=>{
  const name=attr(a,'title'),point=attr(a,'point').split(',').map(Number)
  assert(point.length===2&&point.every(Number.isFinite),'Invalid named POI point')
  return {id:id('nishimoto',name),name,chain_name:'西本真生堂',address:address(attr(a,'address')),lat:point[0],lng:point[1],phone:'',hours:'',retail:name.startsWith('西本真生堂'),sourceUrl,collectedAt,coordinateEvidence:'Official named MapPress POI point; viewport not used'}
 })
}
export function parseDojindo(html,sourceUrl,collectedAt){
 return [...html.matchAll(/<section id="(store\d+)"[^>]*>([\s\S]*?)<\/section>/g)].map(([,code,block])=>{
  const heading=block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]||''
  const name=clean(heading.replace(/<span\b[^>]*>[\s\S]*?<\/span>/g,'')),rawAddress=address(field(block,'住所'))
  return {id:`dojindo-${code}`,name,chain_name:'同仁堂',address:/^熊本県/.test(rawAddress)?rawAddress:'熊本県'+rawAddress,phone:phone(field(block,'電話番号')),hours:field(block,'営業時間'),sourceUrl:`${sourceUrl}#${code}`,collectedAt,retail:/OTC医薬品|医薬品/.test(field(block,'取扱商品'))&&!/保険調剤薬局/.test(name),detailHtml:block}
 })
}
export function parseDaiichi(html,sourceUrl,collectedAt){
 return html.split(/<table\b[^>]*class="shop"[^>]*>/).slice(1).map(block=>{
  const name=clean(block.match(/<p class="shopname">([\s\S]*?)<\/p>/)?.[1]),s=clean(block),rawAddress=s.match(/東京都[^]*?(?=TEL\s*[：:]|TEL:)/)?.[0]||''
  const services=s.split('主要取り扱い商品、サービス')[1]||''
  return {id:id('daiichi',name),name,chain_name:'くすりのダイイチ',address:rawAddress,phone:phone(s),hours:clean(block.match(/営業時間<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/)?.[1]),sourceUrl,collectedAt,retail:/OTC医薬品/.test(services)&&!/（調剤薬局）/.test(name),reason:'Official access maps are raster images; no reliable coordinate marker published'}
 }).filter(x=>x.name)
}
export function parseMarutoList(html){
 return html.split(/<h4>/).slice(1).flatMap(section=>{
  const title=clean(section.split('</h4>')[0])
  if(!/ドラッグストア|ディスカウントパワードラッグ/.test(title))return []
  return [...section.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap(([,block])=>{
   const link=block.match(/class="shop-name"><a href="([^"]+)">([\s\S]*?)<\/a>/)
   if(!link)return []
   return [{name:clean(link[2]),sourceUrl:link[1],phone:phone(block),hours:clean(block.match(/class="shop-time">([\s\S]*?)<\/td>/)?.[1]),retail:!/^（閉店）/.test(clean(link[2]))}]
  })
 })
}
export function parseHikari(html,kml,sourceUrl,collectedAt){
 const markers=[...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map(([,p])=>({name:clean(p.match(/<name>([\s\S]*?)<\/name>/)?.[1]),point:p.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1].trim().split(',').map(Number)}))
 const rows=new Map()
 for(const block of html.replace(/<!--[\s\S]*?-->/g,'').split('<div id="tenpowaku">').slice(1)){
  const branch=clean(block.match(/<div class="xxlarge bold">([\s\S]*?)<\/div>/)?.[1]).replace(/\(旧:.*$/,'').trim()
  if(!branch)continue
  if(rows.has(branch))continue
  const rawAddress=clean(block.match(/住所：([\s\S]*?)<\/div>/)?.[1]),marker=markers.filter(m=>norm(m.name).endsWith(norm(branch)))
  assert(marker.length<=1,'Ambiguous official KML marker')
  let a=address(rawAddress);if(!a.startsWith('京都府'))a='京都府'+a
  rows.set(branch,{id:id('hikari',branch),name:(/烏丸高辻|蛸薬師高倉/.test(branch)?'ローソンドラッグひかり ':'ドラッグひかり ')+branch,chain_name:'ドラッグひかり',address:a,phone:phone(block),hours:clean(block.match(/営業時間：([\s\S]*?)<\/div>/)?.[1]),retail:/医薬品/.test(block),sourceUrl,collectedAt,...(marker.length?{lat:marker[0].point[1],lng:marker[0].point[0],coordinateEvidence:'Official directory embedded MyMaps named Placemark Point matched exact branch suffix',coordinateSourceUrl:'https://www.google.com/maps/d/kml?mid=1-pa1jShpfkdEZscNEGw_y3JfOWkFs5JB&forcekml=1'}:{reason:'No matching official named KML marker'})})
 }
 return [...rows.values()]
}
async function main(){
 const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-additional-chains-2026-10-03',offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume'),get=await createFetcher(out,offline,resume)
 const stores=[],pending=[],excluded=[],sources=[]
 async function accept(row,detailHtml){
  const {retail,detailHtml:unused,markerName,...s}=row
  if(!retail){excluded.push({...s,reason:'Dispensing-only, cosmetics-only, or drugstore retail classification not established'});return}
  try{if(!Number.isFinite(s.lat)){assert(detailHtml||unused,s.reason||'No coordinate marker');Object.assign(s,await getOfficialEmbedMarker(detailHtml||unused,{...s,name:markerName||s.name,sourceUrl:new URL(s.sourceUrl).href},out,{offline,resume}))}stores.push(validateStore(s))}
  catch(e){
   if(s.chain_name==='同仁堂')try{
    const embedUrl=(detailHtml||unused).match(/<iframe[^>]+src="(https:\/\/www\.google\.com\/maps\/embed[^"<>]*)"/)?.[1].replace(/&amp;|&#038;?/g,'&')
    const cached=JSON.parse(await readFile(`${out}/cache/embed-${createHash('sha256').update(embedUrl).digest('hex')}.json`,'utf8'))
    stores.push(validateStore({...s,...parseBuildingMarker(cached.html,embedUrl,s),coordinateCollectedAt:cached.collectedAt}));return
   }catch{}
   pending.push({...s,reason:e.message})
  }
 }
 for(const [brand,url] of Object.entries({nishiichi:'https://nishiichi.co/store/',nishimoto:'https://drug-nishimoto.com/store/',dojindo:'https://dojindo-pharmacy.com/store',daiichi:'https://www.kusu1.com/shop.html',kinouta:'https://kinouta.co.jp/店舗案内',maruto:'https://drug-maruto.jp/shopinfo',hikari:'http://drug-hikari.co.jp/tenpo/'})){
  const before={stores:stores.length,pending:pending.length,excluded:excluded.length}
  try{
   let page=await get(url),rows=[]
   if(brand==='nishiichi'){const map=await get('https://nishiichi.co/_templates/nishiichi02/js/map.js');rows=parseNishiichi(page.html,map.html,url,page.collectedAt)}
   if(brand==='nishimoto')rows=parseNishimoto(page.html,url,page.collectedAt)
   if(brand==='dojindo')rows=parseDojindo(page.html,url,page.collectedAt)
   if(brand==='hikari'){
    const mapUrl='https://www.google.com/maps/d/kml?mid=1-pa1jShpfkdEZscNEGw_y3JfOWkFs5JB&forcekml=1'
    assert(page.html.includes('mid=1-pa1jShpfkdEZscNEGw_y3JfOWkFs5JB'),'MyMaps not linked by official directory')
    const kml=await get(mapUrl);rows=parseHikari(page.html,kml.html,url,page.collectedAt)
   }
   if(brand==='maruto'){
    for(const row of parseMarutoList(page.html)){
     const base={...row,id:id('maruto',row.sourceUrl),chain_name:'くすりのマルト',collectedAt:page.collectedAt}
     if(!row.retail){rows.push(base);continue}
     const detail=await get(row.sourceUrl),html=detail.html
     const a=clean(html.match(/店舗所在地<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/)?.[1])
     const iframe=html.match(/<iframe[^>]+src="([^"]+)"/)?.[1]||'',query=iframe.match(/[?&]q=\s*([\d.]+)\s*,\s*([\d.]+)/)
     rows.push({...base,address:/^いわき市/.test(a)?'福島県'+a:/^(日立市|北茨城市|那珂市|水戸市|ひたちなか市)/.test(a)?'茨城県'+a:a,collectedAt:detail.collectedAt,...(query?{lat:Number(query[1]),lng:Number(query[2]),coordinateEvidence:'Official embedded map q coordinate target; viewport center not used',coordinateSourceUrl:iframe}:{}),detailHtml:html})
    }
   }
   if(brand==='daiichi'){
    // ponytail: shared fetcher assumes UTF-8; this one legacy EUC-JP source needs a decoded byte cache.
    const file=`${out}/daiichi-decoded.json`
    try{page=JSON.parse(await readFile(file,'utf8'))}catch{
     assert(!offline,'No EUC-JP byte cache');const response=await fetch(url,{signal:AbortSignal.timeout(25000)});assert(response.ok)
     page={url,collectedAt:new Date().toISOString(),html:new TextDecoder('euc-jp').decode(await response.arrayBuffer())};await writeFile(file,JSON.stringify(page))
    }
    rows=parseDaiichi(page.html,url,page.collectedAt)
   }
   if(brand==='kinouta'){
    const links=[...new Set([...page.html.matchAll(/href="(https:\/\/kinouta\.co\.jp\/店舗案内\/[^"\s]+)"/g)].map(m=>m[1]))].filter(u=>!u.includes('/pha_'))
    assert(links.length>0,'No retail branch links')
    for(const sourceUrl of links){const detail=await get(sourceUrl),html=detail.html,name=clean(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]).split(/[-|｜]/)[0].trim()
     const rawAddress=clean(html.match(/〒\d{3}-\d{4}[^<]*/)?.[0])
     rows.push({id:id('kinouta',sourceUrl),name,markerName:name.replace(/^ドラッグストア木のうた\s*/,''),chain_name:'木のうた',address:address(rawAddress),phone:phone(html.match(/href="tel:([^"]+)/)?.[1]),hours:clean(html.match(/店舗営業時間<\/p><\/div><div[^>]*><p>([\s\S]*?)<\/p>/)?.[1]),sourceUrl,collectedAt:detail.collectedAt,retail:true,detailHtml:html})
    }
   }
   assert(rows.length>0,'No official branches parsed')
   for(const row of rows)await accept(row)
   sources.push({brand,url,discovered:rows.length,accepted:stores.length-before.stores,pending:pending.length-before.pending,excluded:excluded.length-before.excluded,enumerationComplete:true})
  }catch(e){sources.push({brand,url,error:e.message,enumerationComplete:false})}
  console.log(brand,JSON.stringify(sources.at(-1)))
 }
 assert.equal(new Set(stores.map(s=>s.id)).size,stores.length,'Duplicate accepted IDs')
 const report={generatedAt:new Date().toISOString(),sources,accepted:stores.length,pending:pending.length,excluded:excluded.length,applied:false}
 for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
 console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
