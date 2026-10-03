import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createFetcher,validateStore } from './crawl-national-stores.mjs'
import {getOfficialEmbedMarker} from './official-embed-marker.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
export function parseDrug39(html,url,collectedAt){
  const body=html.match(/店舗基本情報<\/h2>([\s\S]*?)<!-- \/? #?contents -->/)?.[1]||html.slice(html.indexOf('店舗基本情報</h2>'))
  if(!body.includes('label_service_a'))throw Error('No retail drug department')
  const name=plain(html.match(/<title>([^|]+)/)?.[1]||'')
  if(/閉店|休業中/.test(name))throw Error('Closed branch')
  let address=plain(body.match(/class="txt_address">([^<]+)/)?.[1]||'')
  if(!address)throw Error('Missing address')
  const pref=/^山口県|^下関市/.test(address)?'山口県':'福岡県'
  if(!address.startsWith(pref))address=pref+address
  const field=label=>plain(body.match(new RegExp(`<th>${label}</th>\\s*<td>([\\s\\S]*?)</td>`))?.[1]||'')
  const center=body.match(/!2d([\d.]+)!3d([\d.]+)/)
  return {id:`drug39-${url.match(/entry-(\d+)/)[1]}`,name,chain_name:'サンキュードラッグ',address,pref,phone:field('電話番号'),hours:field('営業時間'),lat:null,lng:null,approximateMapCenter:center?{lat:Number(center[2]),lng:Number(center[1])}:null,coordinateStatus:'precise-location-unverified',sourceUrl:url,collectedAt}
}
async function main(){
 const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-drug39-2026-10-03',offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume'),get=await createFetcher(out,offline,resume)
 const home=await get('https://www.drug39.co.jp/store_info/')
 const areas=[...new Set([...home.html.matchAll(/href="(https:\/\/www\.drug39\.co\.jp\/store_info\/[a-z]+\/)"/g)].map(m=>m[1]))].filter(u=>!u.endsWith('/estate/'))
 const urls=new Set(),pages=new Set(),stores=[],accepted=[],pending=[],excluded=[],failures=[]
 for(const area of areas){const queue=[area];for(const url of queue){if(pages.has(url))continue;pages.add(url);const p=await get(url);for(const m of p.html.matchAll(/href="(https:\/\/www\.drug39\.co\.jp\/store_info\/[^" ]+\.html)"/g))if(/entry-\d+\.html$/.test(m[1]))urls.add(m[1]);for(const m of p.html.matchAll(/href="([^"]*\/page\/\d+\/?)"/g)){const next=new URL(m[1],url).href;if(next.startsWith(area)&&!pages.has(next))queue.push(next)}}}
 for(const url of urls){try{const p=await get(url);try{const row=parseDrug39(p.html,url,p.collectedAt);stores.push(row);try{accepted.push(validateStore({...row,...await getOfficialEmbedMarker(p.html,row,out,{offline,resume}),coordinateStatus:'verified-store-marker'}))}catch(e){pending.push({...row,reason:e.message})}}catch(e){excluded.push({url,reason:e.message})}}catch(e){failures.push({url,reason:e.message})}}
 await writeFile(`${out}/stores-addresses.json`,JSON.stringify(stores,null,2))
 await writeFile(`${out}/stores.json`,JSON.stringify(accepted,null,2))
 await writeFile(`${out}/pending.json`,JSON.stringify(pending,null,2))
 await writeFile(`${out}/import.sql`,buildImportSql([],accepted))
 const report={generatedAt:new Date().toISOString(),source:'drug39',areas:areas.length,pages:pages.size,discovered:urls.size,acceptedAddresses:stores.length,accepted:accepted.length,pending:pending.length,excluded,failures,enumerationComplete:failures.length===0,imported:false,coordinateNote:'Only official map entity markers with matching name and phone are import eligible; viewport centers rejected.'}
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,excluded:excluded.length,failures:failures.length}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
