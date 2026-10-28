import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {validGtin} from './import-new-products.mjs'
import {databaseProcess} from './sync-sundrug.mjs'
const origin='https://www.ohm-direct.com',out='artifacts/products-round7-2026-10-28'
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim()
export function parseOhmProduct(html,sourceUrl){
 const id=new URL(sourceUrl).pathname.match(/^\/shopdetail\/(\d+)\/$/)?.[1]
 if(new URL(sourceUrl).origin!==origin||!id)return {reason:'Unexpected product URL'}
 const info=html.match(/<div id="itemInfo">([\s\S]*?)<p id="price"/i)?.[1]||''
 const name=plain(info.match(/\[商品名\]([\s\S]*?)<\/p>/)?.[1]||'')
 const heading=plain(html.match(/<p id="item"[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'')
 const jan=[...plain(info).matchAll(/\[JAN\]\s*(\d{8,14})(?!\d)/g)].map(m=>m[1])
 if(!name||name!==heading)return {reason:'Missing or mismatched main product name',name}
 if(new Set(jan).size!==1||!validGtin(jan[0]))return {reason:'Missing ambiguous or invalid explicit JAN',name}
 const barcode=jan[0],prefix=barcode.padStart(14,'0').slice(1)
 if(/^(?:02|04|2)/.test(prefix)||/^0{5}[02]\d{7}$/.test(prefix))return {reason:'Restricted GTIN',name,barcode}
 const gallery=html.match(/<div id="itemImgBox"[^>]*>([\s\S]*?)<div id="itemInfo">/i)?.[1]||''
 const image=gallery.match(/<img[^>]*src="([^"]+)"/i)?.[1]
 const imageUrl=image?new URL(image,origin):null
 if(!imageUrl||imageUrl.origin!=='https://makeshop-multi-images.akamaized.net'||!(new RegExp(`^/ohmelectric/itemimages/${id}(?:[123])?(?:_[a-z0-9_]+)?\\.[a-z]+$`,'i').test(imageUrl.pathname)||new RegExp(`^/ohmelectric/shopimages/\\d+/\\d+/[1-9][0-9]*_${id}\\.[a-z]+$`,'i').test(imageUrl.pathname)))return {reason:'Missing or mismatched main product image',name,barcode}
 const model=plain(info.match(/\[型番\]([\s\S]*?)<\/p>/)?.[1]||'')
 if(!model||!name.includes(model))return {reason:'Missing or mismatched explicit model',name,barcode}
 return {barcode,name,brand:'',pack:'',category:'',description:'',imageUrl:imageUrl.href,catalogSource:'ohm',sourceUrl}
}
export function ohmLinks(html){return [...new Set([...html.matchAll(/href=["']([^"']+)/g)].map(m=>new URL(m[1].replace(/&amp;/g,'&'),origin)).filter(u=>u.origin===origin&&/^\/shopdetail\/\d+(?:\/|$)/.test(u.pathname)).map(u=>`${origin}/shopdetail/${u.pathname.split('/')[2]}/`))]}
export function parseOhmList(html){
 const scope=html.match(/<div class="section" id="r_categoryList">([\s\S]*?)<ul class="M_pager">/)?.[1]
 const total=Number(html.match(/全([\d,]+)件/)?.[1]?.replaceAll(',',''))
 if(!scope||!Number.isSafeInteger(total)||total<0)throw Error('Missing public listing scope or count')
 const urls=ohmLinks(scope)
 if(total&&(!urls.length||urls.length>50))throw Error('Unexpected public listing product count')
 return {total,urls}
}
async function main(){
 await mkdir(out,{recursive:true});let last=Date.now()
 async function get(url,file){try{return await readFile(`${out}/${file}`,'utf8')}catch{};await new Promise(r=>setTimeout(r,Math.max(0,2100-(Date.now()-last))));last=Date.now();const response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw Error(`${url}: HTTP ${response.status}; stopped without retry`);const html=new TextDecoder('euc-jp').decode(await response.arrayBuffer());await writeFile(`${out}/${file}`,html);return html}
 const all=process.argv.includes('--all'), directoryOnly=process.argv.includes('--directory-only'), urls=[],parsed=[],excluded=[]
 if(all){
  const roots=['ct653','ct35','ct34','ct44','ct31','ct55','ct834','ct40','ct32','ct38','ct37','ct46'],queue=roots.map(c=>`${origin}/shopbrand/${c}/`),visited=new Set(),products=new Set(),pages=[],categories=new Map()
  while(queue.length){const url=queue.shift();if(visited.has(url))continue;visited.add(url);const html=await get(url,`ohm-list-${new URL(url).pathname.split('/').filter(Boolean).slice(1).join('-')}.html`),listing=parseOhmList(html),found=listing.urls,category=new URL(url).pathname.split('/')[2];found.forEach(u=>products.add(u));if(!categories.has(category))categories.set(category,{declared:listing.total,urls:new Set()});found.forEach(u=>categories.get(category).urls.add(u));pages.push({url,total:listing.total,products:found.length});for(const m of html.matchAll(/href=["']([^"']+)/g)){let u=new URL(m[1],origin);if(u.origin===origin&&new RegExp(`^/shopbrand/${category}(?:/page\\d+/(?:recommend|order))?/$`).test(u.pathname)&&!visited.has(u.href))queue.push(u.href)}await writeFile(`${out}/ohm-directory.json`,JSON.stringify({roots,pages,productUrls:[...products],complete:false},null,2));console.log(JSON.stringify({directoryPages:visited.size,queued:queue.length,products:products.size}))}
  const coverage=[...categories].map(([category,v])=>({category,declared:v.declared,discovered:v.urls.size}));if(coverage.some(v=>v.declared!==v.discovered))throw Error('Catalog coverage count mismatch: '+JSON.stringify(coverage));urls.push(...products);await writeFile(`${out}/ohm-directory.json`,JSON.stringify({roots,pages,coverage,productUrls:urls,complete:true},null,2));if(directoryOnly)return
 }else{const listing=await get(`${origin}/shopbrand/ct653/`,'ohm-list-new.html');urls.push(...ohmLinks(listing).slice(0,Number(process.argv[2]||10)))}
 for(const url of urls){const p=parseOhmProduct(await get(url,`ohm-product-${new URL(url).pathname.split('/')[2]}.html`),url);if(p.reason)excluded.push({sourceUrl:url,...p});else parsed.push(p);const fetched=parsed.length+excluded.length;if(fetched%50===0)console.log(JSON.stringify({fetched,total:urls.length,parsed:parsed.length,excluded:excluded.length}));if(fetched%200===0)await writeFile(`${out}/ohm-checkpoint.json`,JSON.stringify({checkedAt:new Date().toISOString(),fetched,total:urls.length,parsed,excluded,final:false,databaseWrites:false},null,2))}
 const knownPath=process.argv.find(a=>a.startsWith('--known='))?.slice(8)
 const existing=knownPath?new Set(JSON.parse(await readFile(knownPath,'utf8')).canonicalBarcodes):new Set(databaseProcess(process.env.AAPRICE_DB_URL,"select lpad(barcode,14,'0') from public.products where barcode ~ '^([0-9]{8}|[0-9]{12,14})$';").split(/\s+/))
 const rows=new Map(),conflicts=new Set()
 for(const p of parsed){const key=p.barcode.padStart(14,'0');if(rows.has(key)&&(rows.get(key).name!==p.name||rows.get(key).pack!==p.pack))conflicts.add(key);else rows.set(key,p)}
 const candidates=[...rows].filter(([key])=>!existing.has(key)&&!conflicts.has(key)).map(([,p])=>p)
 const basename=all?'ohm-full':'ohm'
 await writeFile(`${out}/${basename}.json`,JSON.stringify(candidates,null,2));const report={checkedAt:new Date().toISOString(),scope:all?'Twelve public main catalog roots including new products and their public pagination':'First public new-products listing sample; not whole-brand coverage',attempted:urls.length,parsed:parsed.length,candidates:candidates.length,skippedExisting:[...rows.keys()].filter(k=>existing.has(k)).length,excluded,conflictingJan:[...conflicts],databaseWrites:false,delayMs:2100};await writeFile(`${out}/${basename}-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
