import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseOfficialEmbedMarker,parseWebsiteVerifiedMarker,parseOfficialFeatureMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
export const clean=s=>(s||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const active=s=>s.replace(/<!--[\s\S]*?-->/g,'')
const field=(s,k)=>clean([...s.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].find(m=>clean(m[1])===k)?.[2])
const dfield=(s,k)=>clean(s.match(new RegExp(`<dt[^>]*>\\s*${k}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`))?.[1])
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'')
export function parseNara(html){
 const rows=[]
 for(const [,s]of active(html).matchAll(/<div class="shbox cf">([\s\S]*?)(?=<div class="shbox cf">|$)/g)){
  const name=clean(s.match(/<h4>([\s\S]*?)<\/h4>/)?.[1]),id=s.match(/name="(t\d+)"/)?.[1]
  rows.push({id:'nara-'+id,name:'エムズドラッグ '+name,chain_name:'エムズドラッグ',address:'奈良県'+dfield(s,'住所').replace(/^〒[\d-]+\s*/,''),phone:dfield(s,'TEL＆FAX'),hours:dfield(s,'営業時間'),sourceUrl:'https://ms-drug.com/shop/index.html#'+id,retailEvidence:'Official Ms Drug retail directory',excluded:/閉店/.test(clean(s)),html:s})
 }
 assert(rows.length>0,'Empty Ms Drug directory');return rows
}
export function parseMiz(html){
 return [...active(html).matchAll(/<li>\s*(<div class="tenpoIchiran">[\s\S]*?)<\/li>/g)].map(([,s])=>{
  const link=s.match(/class="tenpoName">\s*<a href="([^"]+)">([^<]+)/),address=field(s,'住所');assert(link,'Missing Miz store link')
  return {id:'miz-'+new URL(link[1]).pathname.match(/\/(\d+)\.html/)?.[1],name:clean(link[2]),chain_name:'ミズ',address:address.startsWith('佐賀市')?'佐賀県'+address:address,phone:field(s,'電話番号').match(/[\d-]{10,13}/)?.[0]||'',hours:field(s,'営業時間'),sourceUrl:link[1],sourceListUrl:'https://www.miz-pharmacy.co.jp/store',retailEvidence:'Explicit official catTenpo drugstore category',excluded:!/catTenpo drugstore/.test(s),html:s}
 })
}
export function parseHanshin(html,url){
 const branch=clean(html.match(/property="og:title" content="([^|]+)/)?.[1]),address=field(html,'所在地').replace(/^〒[\d-]+\s*/,'')
 const products=field(html,'取扱商品'),retail=/薬品類/.test(products)&&/化粧品/.test(products)
 return {id:'hanshin-'+new URL(url).pathname.split('/').at(-1),name:'阪神薬局 '+branch,chain_name:'阪神薬局',address:address.startsWith('大阪府')?address:'大阪府'+address,phone:field(html,'連絡先').match(/(?:Tel|TEL)[：:]?\s*([\d-]+)/)?.[1]||'',hours:field(html,'営業時間'),sourceUrl:url,retailEvidence:'Official products: '+products,excluded:!retail,html}
}
async function main(){
 const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-uncovered-chains-2026-10-03',offline=process.argv.includes('--offline')
 const get=await createFetcher(out,offline,process.argv.includes('--resume')),db=JSON.parse(await readFile('artifacts/drugstores-nationwide-baseline-2026-10-03/database-before.json','utf8'))
 const stores=[],pending=[],excluded=[],existing=[],sources=[]
 async function save(){await Promise.all(Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'existing.json':existing,'report.json':{generatedAt:new Date().toISOString(),baselineCount:db.length,sources,accepted:stores.length,pending:pending.length,excluded:excluded.length,existing:existing.length,applied:false}}).map(([f,v])=>writeFile(`${out}/${f}`,JSON.stringify(v,null,2))))}
 async function accept(candidate,at){
  const {html,excluded:skip,...raw}=candidate,row={...raw,collectedAt:at,taxFree:null}
  if(skip){excluded.push({...row,reason:'Not explicitly classified as retail drugstore or closure'});return}
  assert(!row.classificationPending,'Retail classification requires branch-specific evidence');assert(row.address&&row.name&&row.phone,'Missing authoritative store identity/address/phone')
  const duplicate=db.filter(s=>normalize(s.address)===normalize(row.address));if(duplicate.length===1){existing.push({...row,existingId:duplicate[0].id,existingChain:duplicate[0].chain_name});return}
  const matchRow={...row,name:row.name.replace(/^(?:くすりのコーエイ|阪神薬局|ドラッグミック|エムズドラッグ)\s*/, '').replace(/^ファミリーマート[＋+]/,'')};let marker=row.officialCoordinates||null,errors=[]
  const embed=html?.match(/<iframe[^>]*src="(https:\/\/www\.google\.com\/maps\/embed\?[^"<>]+)/)?.[1]?.replace(/&amp;/g,'&')
  if(embed&&!marker)try{const page=await get(embed);let found;try{found=parseOfficialEmbedMarker(page.html,matchRow)}catch{found=parseOfficialFeatureMarker(page.html,embed,matchRow)}verifyMarkerAddress(found,row);marker={...found,coordinateSourceUrl:embed,coordinateCollectedAt:page.collectedAt}}catch(e){errors.push(e.message)}
  if(!marker)for(const query of [row.name+' '+row.address.split(/\s/)[0],row.name]){const u=new URL('https://www.google.com/maps');u.search=new URLSearchParams({q:query,output:'embed',hl:'ja'});try{const page=await get(u.href);let found;try{found=parseOfficialEmbedMarker(page.html,matchRow)}catch{found=parseWebsiteVerifiedMarker(page.html,matchRow)}verifyMarkerAddress(found,row);marker={...found,coordinateSourceUrl:u.href,coordinateCollectedAt:page.collectedAt};break}catch(e){errors.push(e.message)}}
  assert(marker,errors.join('; '));assert(!stores.some(s=>s.id===row.id),'Duplicate accepted store ID');const {officialCoordinates,...identity}=row;stores.push(validateStore({...identity,...marker,coordinateStatus:'verified-store-marker'}))
 }
 async function chain(source,fn){const r={source,enumerationComplete:false},before=[stores.length,pending.length,excluded.length,existing.length];sources.push(r);try{const rows=await fn(r);r.discovered??=rows.length;for(const row of rows){try{await accept(row,r.collectedAt)}catch(e){const {html,...raw}=row;pending.push({...raw,reason:e.message})}await save()}r.enumerationComplete=true}catch(e){r.failure=e.message;pending.push({source,reason:e.message})}Object.assign(r,{accepted:stores.length-before[0],pending:pending.length-before[1],excluded:excluded.length-before[2],existing:existing.length-before[3]});await save();console.log(JSON.stringify(r))}
 await chain('nara',async r=>{r.sourceUrl='https://ms-drug.com/shop/index.html';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt;return parseNara(p.html)})
 await chain('hanshin',async r=>{r.sourceUrl='https://www.hanshin-yakkyoku.co.jp/';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt;const urls=[...new Set([...p.html.matchAll(/href="(\/shop\/[^"/]+)"/g)].map(m=>new URL(m[1],r.sourceUrl).href))];assert(urls.length,'No Hanshin branches');const rows=[];for(const u of urls){try{const d=await get(u);rows.push({...parseHanshin(d.html,u),collectedAt:d.collectedAt})}catch(e){pending.push({source:r.source,sourceUrl:u,reason:e.message})}}return rows})
 await chain('miz',async r=>{r.sourceUrl='https://www.miz-pharmacy.co.jp/store';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt;const rows=parseMiz(p.html);for(const row of rows.filter(x=>!x.excluded)){const d=await get(row.sourceUrl);row.html=d.html}return rows})
 await chain('koei',async r=>{
  r.sourceUrl='http://www.drugkoei.com/storelist';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt
  const urls=[...new Set([...active(p.html).matchAll(/href="(http:\/\/www\.drugkoei\.com\/storelist\/[^"/]+\/)"/g)].map(m=>m[1]))],rows=[];assert.equal(urls.length,14,'Official Koei total changed')
  for(const url of urls){const d=await get(url),h=active(d.html),f=k=>clean(h.match(new RegExp(`<div class="left">${k}</div>\\s*<div class="right">([\\s\\S]*?)(?:</td>)?</div>`))?.[1]),name=clean(h.match(/<h3>([^<]+)<\/h3>/)?.[1]);rows.push({id:'koei-'+new URL(url).pathname.split('/').filter(Boolean).at(-1),name:'くすりのコーエイ '+name,chain_name:'くすりのコーエイ',address:'福岡県'+f('住所'),addressEvidence:'Official branch address plus company directory Fukuoka scope',phone:f('電話番号'),hours:f('営業時間'),sourceUrl:url,sourceListUrl:r.sourceUrl,retailEvidence:'Official retail products: '+f('取り扱い商品'),excluded:!/医薬品/.test(f('取り扱い商品'))||!/化粧品/.test(f('取り扱い商品')),html:h})}
  return rows
 })
 await chain('mik',async r=>{
  r.sourceUrl='https://drugmik.com/shopinfo/';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt
  const urls=[...new Set([...active(p.html).matchAll(/href="(https:\/\/drugmik\.com\/shopinfo\/[^"/]+\/)"/g)].map(m=>new URL(m[1]).href))],rows=[];assert(urls.length>0,'Empty Drug Mik directory')
  for(const url of urls){const d=await get(url),h=active(d.html),section=h.match(/<section class="entry-content cf">([\s\S]*?)<\/section>/)?.[1]||h,f=k=>clean(section.match(new RegExp(`<h5[^>]*>${k}</h5>\\s*<p>([\\s\\S]*?)</p>`))?.[1]),name=clean(h.match(/<h1 class="entry-title[^>]*>([\s\S]*?)<\/h1>/)?.[1]);rows.push({id:'mik-'+createHash('sha256').update(decodeURI(url)).digest('hex').slice(0,16),name,chain_name:'ドラッグミック',address:f('住所').replace(/^〒[\d-]+\s*/,''),phone:f('TEL'),hours:f('営業時間'),sourceUrl:url,sourceListUrl:r.sourceUrl,retailEvidence:'Official Drug Mik retail-store directory',excluded:/閉店/.test(clean(section)),html:h})}
  return rows
 })
 await chain('muragen',async r=>{
  r.sourceUrl='http://muragen.com/tenpo/';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt
  const urls=[...new Set([...active(p.html).matchAll(/href="(http:\/\/muragen\.com\/tenpo\/[^"/]+\/)"/g)].map(m=>new URL(m[1]).href.toLowerCase()))],rows=[]
  for(const url of urls){const d=await get(url),h=active(d.html),name=clean(h.match(/<div class="b2col_tenpoBox"[^>]*>\s*<h4>([^<]+)/)?.[1]),box=h.match(/<div class="tenpoAdd">([\s\S]*?)<\/div>/)?.[1]||'',address=clean(box.match(/<p>([\s\S]*?〒[\s\S]*?)<\/p>/)?.[1]).replace(/^〒[\d-]+\s*/,''),coord=h.match(/class="marker" data-lat="([\d.]+)" data-lng="([\d.]+)"/);rows.push({id:'muragen-'+createHash('sha256').update(decodeURI(url)).digest('hex').slice(0,16),name,chain_name:'村源',address:address.startsWith('盛岡市')?'岩手県'+address:address,phone:clean(box).match(/TEL\s*([\d-]+)/)?.[1],hours:clean(box).split('営業時間')[1]||'',sourceUrl:url,sourceListUrl:r.sourceUrl,retailEvidence:'Official retail department separate from pharmacy dispensing room; retail sales flyer',excluded:/調剤室|あたご薬局|もなか薬局/.test(name),html:h,officialCoordinates:coord?{lat:Number(coord[1]),lng:Number(coord[2]),coordinateEvidence:'Official store map class marker data-lat/data-lng',coordinateSourceUrl:url}:null})}
  return rows
 })
 await chain('yasui',async r=>{
  r.sourceUrl='https://www.e-kusuri.info/drugstore';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt
  const headings=[...p.html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].filter(m=>/^(マツモトキヨシ|ヤスイ本店)/.test(clean(m[1]))),rows=[]
  for(let i=0;i<headings.length;i++){const m=headings[i],h=p.html.slice(m.index,headings[i+1]?.index||p.html.length),text=clean(h),name=clean(m[1]),address=text.match(/〒[\d-]+\s*((?:東京都|千葉県).*?)(?=Tel|営業時間|&nbsp;)/)?.[1]?.trim();rows.push({id:'yasui-'+i,name,chain_name:'ヤスイ',address,phone:text.match(/Tel[：:]\s*([\d-]+)/)?.[1]||'',hours:'',sourceUrl:r.sourceUrl,retailEvidence:'Official drugstore department directory',excluded:/営業をお休み|リニューアル工事/.test(text),html:h})}
  return rows
 })
 await chain('hotta',async r=>{
  r.sourceUrl='https://hotta-pharma.co.jp/storeinformation/';const p=await get(r.sourceUrl);r.collectedAt=p.collectedAt;const headings=[...p.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].slice(1),rows=[]
  for(let i=0;i<headings.length;i++){const m=headings[i],h=p.html.slice(m.index,headings[i+1]?.index||p.html.length),name=clean(m[1]).split(/202\d年/)[0].trim(),address=field(h,'住所').replace(/^〒[\d-]+\s*/,'');rows.push({id:'hotta-'+createHash('sha256').update(name).digest('hex').slice(0,16),name,chain_name:'ホッタ晴信堂薬局',address:address.startsWith('東京都')?address:'東京都'+address,phone:(field(h,'電話/FAX')||field(h,'電話')).match(/[\d-]{10,13}/)?.[0]||'',hours:field(h,'営業時間'),sourceUrl:r.sourceUrl,retailEvidence:'Official mixed drugstore group; main store OTC/cosmetics floor',excluded:/アルビオン/.test(name),classificationPending:!(/本店$/.test(name)||/アルビオン/.test(name)),html:h})}
  return rows
 })
 await chain('meijido',async r=>{
  r.sourceUrl='https://www.yoshizuya.com/affiliate/';const p=await get(r.sourceUrl),mallIndex=await get('https://www.yoshizuya.com/store/');r.collectedAt=p.collectedAt
  const malls=[...mallIndex.html.matchAll(/href="(https:\/\/www\.yoshizuya\.com\/store\/[^"/]+\/)"[^>]*>([^<]+)<\/a>/g)].map(m=>({url:m[1],name:clean(m[2])})),links=[...p.html.matchAll(/href="(\/tenant\/meijido[^"/]+)">([^<]+)/g)],rows=[]
  assert.equal(links.length,6,'Official Meijido total changed')
  for(const [,path,name]of links){const url=new URL(path,r.sourceUrl).href,d=await get(url),branch=name.replace('明治堂薬品','').trim(),mall=malls.find(x=>x.name===branch)||malls.find(x=>x.name===branch.replace(/^新/,''));assert(mall,'Missing authoritative parent-mall link for '+name);const location=await get(mall.url),address=clean(location.html.match(/<li>((?:愛知県|岐阜県|三重県)[\s\S]*?)<\/li>/)?.[1]),info=d.html.match(/<h2>店舗情報<\/h2>([\s\S]*?)(?:<\/section>|<h2>)/)?.[1]||'';rows.push({id:'meijido-'+path.split('/').at(-1),name,chain_name:'明治堂薬品',address,phone:clean(info).match(/TEL[：:]\s*([\d-]+)/)?.[1]||'',hours:'',sourceUrl:url,sourceListUrl:r.sourceUrl,addressSourceUrl:mall.url,addressEvidence:'Official retailer department inside the named official parent mall',retailEvidence:'Official tenant explicitly drugstore, company directory states six stores',html:d.html})}
  return rows
 })
 await chain('mikawa',async r=>{r.sourceUrl='http://mikawa.la.coocan.jp/';r.discoverySourceUrl='https://www.nidrug.jp/organization';await get(r.sourceUrl);throw Error('Current retail directory unverified')})
 await chain('yokohama-pharmacy',async r=>{r.sourceUrl='https://drug-asahi.co.jp/ten.html';r.alreadyMappedBaselineCount=34;r.enumerationComplete=true;r.reason='Corporate member maps to already imported スーパードラッグアサヒ; unresolved format/marker ledger remains in original artifacts';return []})
 await save()
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
