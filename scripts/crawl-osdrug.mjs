import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').normalize('NFKC').replace(/\s+/g,' ').trim()
export function parseOsdrugDirectory(html,collectedAt){
 const rows=[],excluded=[]
 for(const raw of html.split(/<TABLE width="503"[^>]*>/i).slice(1)){
  const block=raw.split(/<\/TABLE>/i)[0],branch=clean(block.match(/<FONT color="#003300">([\s\S]*?)<\/FONT>/i)?.[1]).replace(/\s/g,'')
  if(branch==='本社'){excluded.push({name:branch,reason:'Corporate office'});continue}
  const heading=clean(block.match(/<FONT color="#003300">([\s\S]*?)<\/FONT>/i)?.[1])
  assert(branch&&heading,'Unparsed official directory block')
  const text=clean(block).slice(heading.length).trim(),address=text.split(/Tel\./i)[0].trim(),phone=text.match(/Tel\.\s*([\d\s－ー-]+)/i)?.[1]?.replace(/\s/g,''),hours=text.match(/営業時間\s*(.*?)(?=JR|阪急|大阪メトロ|京阪|近鉄|東京メトロ|$)/)?.[1]?.trim()
  // Retain empty official entries as pending; absence is not proof of closure.
  rows.push({id:'osdrug-'+createHash('sha256').update(branch).digest('hex').slice(0,16),name:'オーエスドラッグ '+branch,chain_name:'オーエスドラッグ',address,phone,hours,sourceUrl:'http://www.osdrug.com/sub1.htm',collectedAt,branch,retailEvidence:'Official OS Drug chain retail branch directory'})
 }
 assert(rows.length>0,'Empty official directory');assert.equal(new Set(rows.map(r=>r.id)).size,rows.length)
 return {rows,excluded}
}
async function main(){
 const out=process.argv.find(s=>s.startsWith('--out='))?.slice(6)||'artifacts/drugstores-osdrug-2026-10-03',offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume')
 await mkdir(out+'/cache',{recursive:true})
 let directory
 try{if(offline||resume)directory=JSON.parse(await readFile(out+'/cache/directory.json','utf8'))}catch{}
 if(!directory){assert(!offline,'No cached official directory');const response=await fetch('http://www.osdrug.com/sub1.htm',{signal:AbortSignal.timeout(15000)});assert(response.ok);directory={url:response.url,collectedAt:new Date().toISOString(),html:new TextDecoder('shift_jis').decode(await response.arrayBuffer())};await writeFile(out+'/cache/directory.json',JSON.stringify(directory))}
 const {rows,excluded}=parseOsdrugDirectory(directory.html,directory.collectedAt),stores=[],pending=[]
 for(const row of rows){
  try{
   assert(row.address&&row.phone&&row.hours,'Missing official address/phone/hours')
   const url=new URL('https://www.google.com/maps');url.search=new URLSearchParams({q:row.name+' '+row.address,output:'embed',hl:'ja'})
   const file=out+'/cache/'+createHash('sha256').update(url.href).digest('hex')+'.json';let page
   try{page=JSON.parse(await readFile(file,'utf8'))}catch{assert(!offline,'No cached public marker');const r=await fetch(url,{signal:AbortSignal.timeout(15000)});assert(r.ok);page={url:url.href,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(page));await new Promise(r=>setTimeout(r,1000))}
   const marker=parseOfficialEmbedMarker(page.html,{...row,name:row.branch.replace(/店$/,'')})
   const pref=marker.coordinateEntityAddress.match(/東京都|大阪府|京都府|神奈川県|埼玉県|兵庫県/)?.[0]
   assert(pref,'No prefecture on verified business marker')
   const identity={...row,address:/^(東京都|大阪府|京都府|神奈川県|埼玉県|兵庫県)/.test(row.address)?row.address:pref+row.address}
   verifyMarkerAddress(marker,identity)
   stores.push(validateStore({...identity,...marker,coordinateSourceUrl:page.url,coordinateCollectedAt:page.collectedAt,coordinateStatus:'verified-store-marker',addressEvidence:'Official street address and prefecture of matching phone/name business marker'}))
  }catch(e){pending.push({...row,reason:e.message})}
  if((stores.length+pending.length)%10===0)console.log('OS Drug',stores.length+pending.length+'/'+rows.length,'verified',stores.length)
 }
 const report={generatedAt:new Date().toISOString(),source:directory.url,sourceEncoding:'shift_jis',discovered:rows.length+excluded.length,accepted:stores.length,pending:pending.length,excluded:excluded.length,enumerationComplete:true,scope:'Full currently published official HTML list; does not prove directory freshness or full operating-network size',applied:false}
 for(const [f,data] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(out+'/'+f,JSON.stringify(data,null,2))
 console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
