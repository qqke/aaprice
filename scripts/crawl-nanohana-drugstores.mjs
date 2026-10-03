import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {databaseProcess} from './sync-sundrug.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs'
import {parseOfficialEmbedMarker,parseOfficialFeatureMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-membership-retail-root-2026-10-03'
const text=s=>s.replace(/<br\s*\/?>/g,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().normalize('NFKC')
export function parseNanohanaDrugstores(html,sourceUrl,collectedAt){
 const current=html.replace(/<!--[\s\S]*?-->/g,'')
 return [...current.matchAll(/<div class="drugstore-shop_cell-title">([\s\S]*?)<\/div>\s*<div class="drugstore-shop_cell-text">([\s\S]*?)<\/div>/g)].map(m=>{
 const name=text(m[1]),body=text(m[2]),address=body.match(/(?:東京都|北海道|大阪府|京都府|.{2,3}県)[\s\S]*?(?=\nTEL)/)?.[0].replace(/\n/g,' ').trim(),phone=body.match(/TEL[：:]\s*([\d-]+)/)?.[1],hours=body.match(/営業時間[：:]([\s\S]*?)(?:\n駐車場|$)/)?.[1].trim()
 if(!address||!phone)throw Error('Official drugstore block lacks address or telephone')
 return {id:'nanohana-drug-'+createHash('sha256').update(name).digest('hex').slice(0,12),name,chain_name:name.startsWith('コヤマ')?'ヘルスケアコヤマ':'なの花ドラッグ',address,phone,hours,sourceUrl,collectedAt,operator:body.split('\n')[0],retailClassification:'Explicit drugstore section of current official group directory; online stores and dispensing pharmacy directory excluded'}
 })
}
async function main(){
 const source=JSON.parse(await readFile(out+'/cache/nanohana.json','utf8')),rows=parseNanohanaDrugstores(source.html,source.url,source.collectedAt)
 if(rows.length!==7)throw Error('Official directory count requires renewed reconciliation')
 const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from(select id,name,chain_name,address,pref,lat,lng from public.stores)s;")
 const db=JSON.parse(raw.slice(raw.indexOf('['))),review=indexExistingBranches(db),stores=[],pending=[]
 for(const row of rows){row.pref=row.address.match(/^(?:東京都|北海道|大阪府|京都府|.{2,3}県)/)?.[0];try{
 const existing=possibleExistingBranches(row,review);if(existing.length)throw Error('Existing branch review '+existing.join(','))
 const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',file=out+'/cache/marker-'+row.id+'.json';let page
 try{page=JSON.parse(await readFile(file,'utf8'))}catch{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);page={url,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(page))}
 let marker,coordinateUrl=url,coordinateDate=page.collectedAt
 try{marker=parseOfficialEmbedMarker(page.html,row)}catch(originalError){
 const details={'0246-85-0682':['iwaki','https://www.nanohana-ph.jp/shop/touhoku/fukushima/iwaki/dorag-iwaki.php'],'072-633-4460':['minami','https://www.nanohana-ph.jp/shop/kinki/osaka/ibaraki/dorag-minamiibaraki.php'],'072-739-6216':['minoo-official','https://www.nanohana-ph.jp/shop/kinki/osaka/minoh/dorag-minosegawa.php']},selected=details[row.phone]
 if(!selected)throw originalError
 const detail=JSON.parse(await readFile(out+'/cache/detail-'+selected[0]+'.json','utf8')),officialName=text(detail.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]||'')
 if(detail.url!==selected[1]||!detail.html.includes(row.phone)||!officialName.includes('なの花ドラッグ'))throw Error('Current official detail identity differs')
 const embed=detail.html.match(/<iframe[^>]+src="(https:\/\/www.google.com\/maps\/embed[^"<>]+)"/)?.[1]
 if(!embed)throw Error('Official detail has no selected map feature')
 const file=out+'/cache/official-embed-'+selected[0].replace('-official','')+'.json';let map
 try{map=JSON.parse(await readFile(file,'utf8'))}catch{const r=await fetch(embed,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);map={url:embed,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(map))}
 if(map.url!==embed)throw Error('Cached embed differs from current official selection')
 marker=parseOfficialFeatureMarker(map.html,embed,{...row,name:officialName,address:normalizeAddress(row.address)})
 row.officialDirectoryName=row.name;row.name=officialName;row.sourceUrl=detail.url;coordinateUrl=embed;coordinateDate=map.collectedAt
 }
 verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)})
 const nearby=db.filter(d=>Math.hypot((d.lat-marker.lat)*111320,(d.lng-marker.lng)*111320*Math.cos(marker.lat*Math.PI/180))<60)
 if(nearby.length)throw Error('Nearby existing-store review '+nearby.map(d=>d.id).join(','))
 stores.push(validateStore({...row,...marker,coordinateSourceUrl:coordinateUrl,coordinateCollectedAt:coordinateDate,coordinateEvidence:marker.coordinateVerification||marker.coordinateEvidence}))
 }catch(e){pending.push({...row,reason:e.message})}}
 const report={at:new Date().toISOString(),databaseRows:db.length,enumerated:rows.length,accepted:stores.length,pending:pending.length,officialDrugstoreDirectory:'https://www.nanohana-ph.jp/drugstore.php',enumerationCountSource:'https://www.nanohana-ph.jp/shop/',asOf:'2026-09-30',directoryEnumerationComplete:true,allBranchesAligned:false,nationalComplete:false}
 for(const [name,data]of Object.entries({candidates:rows,stores,pending,report}))await writeFile(out+'/nanohana-'+name+'.json',JSON.stringify(data,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
