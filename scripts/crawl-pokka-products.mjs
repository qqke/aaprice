import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {validGtin} from './import-new-products.mjs';
const origin='https://www.pokkasapporo-fb.jp',out='artifacts/products-round8-2026-10-28';
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replaceAll('&amp;','&').replaceAll('&nbsp;',' ').replaceAll('&quot;','"').replace(/\s+/g,' ').trim();
export function parsePokkaProduct(html,sourceUrl){
 if(new URL(sourceUrl).origin!==origin||!/^\/products\/[^/]+\/[^/]+\/[^/]+\.html$/.test(new URL(sourceUrl).pathname))throw Error('Unexpected official product URL');
 const field=key=>plain(html.match(new RegExp(`<td[^>]*class="[^"]*\\brt_cf_p_${key}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`))?.[1]);
 const name=plain(html.match(/<h1[^>]*class="[^"]*rt_cf_p_product_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1]),barcode=field('jan_code'),pack=field('yoryo');
 if(!/^(?:\d{8}|\d{12,14})$/.test(barcode)||!validGtin(barcode)||/^(?:02|04|2)/.test(barcode.padStart(14,'0').slice(1)))throw Error('Missing or invalid explicit JAN');
 if(!name||!pack||!/[0-9０-９]/.test(pack)||!/ml|[gLｇＧＬ]|グラム|粒|袋|個|本|食|枚|包|缶|瓶|カップ|ペット|PET|紙/i.test(pack))throw Error('Missing manufacturer unit');
 const img=html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*\brt_cf_p_img1\b[^"]*"/);if(!img)throw Error('Missing same-page main image');
 const imageUrl=new URL(img[1],origin).href;if(new URL(imageUrl).origin!==origin||!new URL(imageUrl).pathname.startsWith('/products/cms/images/'))throw Error('Unexpected main image origin');
 if(/<[^>]+class="[^"]*\brt_cf_p_product_end_date\b[^"]*"[^>]*>\s*\d/.test(html))throw Error('Manufacturer production end date shown');
 return {barcode,name,pack,brand:'',category:'食品・飲料',description:'',imageUrl,catalogSource:'pokka',sourceUrl};
}
export function uniquePokkaProducts(products){const groups=new Map(),rows=[],excluded=[];for(const p of products){let k=p.barcode.padStart(14,'0');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}for(const group of groups.values()){if(group.some(p=>p.name!==group[0].name||p.pack!==group[0].pack))excluded.push(...group.map(p=>({...p,reason:'Same JAN has conflicting manufacturer name or unit'})));else rows.push(group[0]);}return {rows,excluded};}
export async function discoverPokkaDirectory(get){
 const robots=await get(`${origin}/robots.txt`,false,true);
 if(robots.status!==404&&/Disallow:\s*\S|Crawl-delay:/i.test(robots.html))throw Error('Review changed robots restrictions before crawling');
 const home=(await get(`${origin}/products/`)).html;
 const categories=[...new Set([...home.matchAll(/href="(\/products\/[a-z]+\/)"/g)].map(m=>m[1]))].filter(path=>path!=='/products/allergy/');
 assert(categories.length>0,'No public categories discovered');
 const products=new Map(),pages=[];
 for(const path of categories){
  const html=(await get(origin+path)).html,cat=path.split('/')[2];
  const ids=[...new Set([...html.matchAll(/<details[^>]*class="[^"]*\brt_cf_product_category_id\b[^"]*"[^>]*id="([a-z_-]+)"/g)].map(m=>m[1]))];
  assert(ids.length>0,`Missing subcategories ${path}`);
  if(/href="[^"]*(?:[?&]page=|_p\d|page\d)/.test(html))throw Error('Review newly added category pagination');
  for(const id of ids){
   const url=`${origin}/ajax/products/list2/${cat}/${id}.json`,json=JSON.parse((await get(url)).html);
   assert(Array.isArray(json.rt_bn_product_list),`Missing public product list ${url}`);
   assert(Object.keys(json).every(key=>key==='rt_bn_product_list'),'Review changed list response or pagination');
   for(const row of json.rt_bn_product_list){const url=new URL(row.rt_cf_p_detail_href.href,origin);assert(url.origin===origin&&/^\/products\/[^/]+\/[^/]+\/[^/]+\.html$/.test(url.pathname));products.set(url.href,{url:url.href,...row});}
   pages.push({cat,id,rawRows:json.rt_bn_product_list.length});
  }
 }
 return {checkedAt:new Date().toISOString(),robotsStatus:robots.status||200,categoryCount:categories.length,subcategoryCount:pages.length,processedSubcategories:pages.length,complete:true,pages,products:[...products.values()],uniqueProductCount:products.size};
}
async function main(){
 await mkdir(`${out}/pokka-cache`,{recursive:true});
 const products=[],excluded=[],evidence=[],failures=[];let fetched=0,last=Date.now();
 async function get(url,image=false,allow404=false){assert.equal(new URL(url).origin,origin);let file=`${out}/pokka-cache/${createHash('sha256').update(url).digest('hex')}.json`;try{let c=JSON.parse(await readFile(file,'utf8'));return c;}catch{}await new Promise(r=>setTimeout(r,Math.max(0,2500-(Date.now()-last))));last=Date.now();const response=await fetch(url,{headers:{'User-Agent':'AAPriceCatalog/1.0'},signal:AbortSignal.timeout(30000)});assert.equal(new URL(response.url).origin,origin);if(allow404&&response.status===404){const result={url,status:404,html:''};await writeFile(file,JSON.stringify(result));return result;}if(!response.ok)throw Object.assign(Error(`HTTP ${response.status} ${url}`),{status:response.status});assert.equal(new URL(response.url).origin,origin);const result=image?{url,type:response.headers.get('content-type'),bytes:(await response.arrayBuffer()).byteLength}:{url,html:await response.text()};if(image&&!result.type?.startsWith('image/'))throw Error('Main image is not image content');await writeFile(file,JSON.stringify({...result,collectedAt:new Date().toISOString()}));return result;}
 let directory;try{directory=JSON.parse(await readFile(`${out}/pokka-directory.json`,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;directory=await discoverPokkaDirectory(get);await writeFile(`${out}/pokka-directory.json`,JSON.stringify(directory,null,2));}
 assert(directory.complete&&directory.processedSubcategories===directory.subcategoryCount&&directory.products.length>0);
 const knownFile=`${out}/pokka-known.json`;let known,knownSnapshotUnavailable=false;
 try{known=new Set(JSON.parse(await readFile(knownFile,'utf8')));}catch(error){
  if(error.code!=='ENOENT')throw error;
  try{const snapshot=JSON.parse(await readFile('artifacts/products-round7-2026-10-28/known-barcodes.json','utf8'));assert(Array.isArray(snapshot.canonicalBarcodes));known=new Set(snapshot.canonicalBarcodes.map(code=>code.padStart(14,'0')));}catch(error){if(error.code!=='ENOENT')throw error;known=new Set();knownSnapshotUnavailable=true;}
  if(!knownSnapshotUnavailable)await writeFile(knownFile,JSON.stringify([...known]));
 }
 const value=x=>typeof x==='object'?x?.content:x;const current=directory.products.filter(x=>value(x.rt_cf_p_status)!=='3'&&value(x.rt_cf_p_product_end_date_pass)!=='1');
 async function save(complete=false){const unique=uniquePokkaProducts(products),candidates=unique.rows.filter(p=>!known.has(p.barcode.padStart(14,'0')));await writeFile(`${out}/pokka.json`,JSON.stringify(candidates,null,2));await writeFile(`${out}/pokka-evidence.json`,JSON.stringify(evidence,null,2));await writeFile(`${out}/pokka-report.json`,JSON.stringify({generatedAt:new Date().toISOString(),scope:'Current public consumer catalog only; excludes product-old archive and ended directory items',robotsStatus:directory.robotsStatus,categoryCount:directory.categoryCount,subcategoryCount:directory.subcategoryCount,directoryProductCount:directory.products.length,currentProductCount:current.length,fetched,validUnique:unique.rows.length,candidates:candidates.length,knownSkipped:unique.rows.length-candidates.length,knownSnapshotUnavailable,excluded:[...excluded,...unique.excluded],failures,complete,databaseWrites:false,requestIntervalMs:2500},null,2));}
 await save();for(const entry of current){try{const cached=await get(entry.url);let p;try{p=parsePokkaProduct(cached.html,entry.url);}catch(error){excluded.push({sourceUrl:entry.url,reason:error.message});fetched++;await save();continue;}if(!known.has(p.barcode.padStart(14,'0'))){const img=await get(p.imageUrl,true);evidence.push({...p,explicitJanField:true,manufacturerUnit:p.pack,mainImageSamePage:true,imageContentType:img.type,imageBytes:img.bytes,verifiedAt:new Date().toISOString()});}products.push(p);fetched++;await save();console.log(`Pokka ${fetched}/${current.length}; ${products.length} parsed`);}catch(error){failures.push({url:entry.url,reason:error.message,status:error.status});await save();throw error;}}
 await save(true);
}
if(process.argv.includes('--test')){const fixture='<h1 class="rt_cf_p_product_title">富良野ラベンダーティー（500ml）</h1><td class="rt_cf_p_jan_code">4589850821455</td><td class="rt_cf_p_yoryo">500ml／PETボトル</td><img src="/products/cms/images/JM18.jpg" class="rt_cf_p_img1">',url=origin+'/products/cha/cha/JM18.html';assert.equal(parsePokkaProduct(fixture,url).barcode,'4589850821455');assert.equal(parsePokkaProduct(fixture,url).brand,'');assert.throws(()=>parsePokkaProduct(fixture.replace('4589850821455','4589850821456'),url));assert.throws(()=>parsePokkaProduct(fixture.replace('4589850821455','4589850821455（ケースJANコード）'),url));const p=parsePokkaProduct(fixture,url);assert.equal(uniquePokkaProducts([p,{...p,pack:'24本'}]).rows.length,0);assert.equal(uniquePokkaProducts([p,p]).rows.length,1);assert.throws(()=>parsePokkaProduct(fixture,url.replace(origin,'https://example.com')));const directory=await discoverPokkaDirectory(async url=>{if(url.endsWith('/robots.txt'))return {status:404,html:''};if(url===origin+'/products/')return {html:'<a href="/products/cha/">Tea</a><a href="/products/allergy/">Allergy</a>'};if(url===origin+'/products/cha/')return {html:'<details class="rt_cf_product_category_id" id="cha">'};assert.equal(url,origin+'/ajax/products/list2/cha/cha.json');return {html:JSON.stringify({rt_bn_product_list:[{rt_cf_p_detail_href:{href:'/products/cha/cha/JM18.html'}}]})};});assert.equal(directory.uniqueProductCount,1);assert.equal(directory.subcategoryCount,1);assert.equal(directory.robotsStatus,404);console.log('Pokka parser/unit/conflict/directory checks passed');}
else if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
