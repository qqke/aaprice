import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {normalizeJapaneseStreet} from './reconcile-pending-drugstores.mjs'
import {parseOfficialEmbedMarker,parseWebsiteVerifiedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const reviewedRepresentations={
 'ainz-0208':{actual:'〒133-0056 東京都江戸川区南小岩７丁目２４−１ 小岩ショッピングセンタ 1F',ordered:'東京都江戸川区南小岩7丁目24-1 小岩ショッピングセンター1F',officialAlternative:true,sources:['https://hrmos.co/pages/ain/jobs/03_02_0073','https://shapo.jrtk.jp/koiwa/shop/index.jsp?bf=1&fmt=6&shopid=1210'],evidence:'Official Ain Group recruitment for named シャポー小岩 branch explicitly states 南小岩7丁目24-1 小岩ショッピングセンター1F; exact store phone matches both official chain/tenant and business map. Chain/whole-mall address 7-24-15 remains preserved'},
 'ainz-0185':{actual:'Ima, ５丁目-１-１ 光が丘 練馬区 東京都 179-0072',ordered:'東京都練馬区光が丘5丁目-1-1',evidence:'Map components 5-1-1 / 光が丘 / 練馬区 / 東京都 reversed; every component preserved'},
 'ainz-0150':{actual:'京王百貨店新宿店 2f, １丁目-１-４ 西新宿 新宿区 東京都 160-8321',ordered:'東京都新宿区西新宿1丁目-1-4',evidence:'Map components 1-1-4 / 西新宿 / 新宿区 / 東京都 reversed; store building and floor also agree'},
 'ainz-0193':{actual:'アミュプラザ鹿児島 1F, １-１ 中央町 鹿児島市 鹿児島県 890-0053',ordered:'鹿児島県鹿児島市中央町1-1',evidence:'Map components 1-1 / 中央町 / 鹿児島市 / 鹿児島県 reversed; named facility/floor also agree'},
 'sunroad-b465a781967f6fbf':{actual:'７２４０ 神子柴, 南箕輪村 上伊那郡 長野県 399-4511',ordered:'長野県上伊那郡南箕輪村神子柴7240',evidence:'Map components 7240 / 神子柴 / 南箕輪村 / 上伊那郡 / 長野県 reversed; every component preserved'},
 'asahi-45':{actual:'ユザワプラザ, 1F, ２丁目-１-１８ 材木町 湯沢市 秋田県 012-0845',ordered:'秋田県湯沢市材木町2丁目-1-18',evidence:'Map components 2-1-18 / 材木町 / 湯沢市 / 秋田県 reversed; named facility/floor also agree'},
 'yamazawa-amarume':{actual:'〒999-7781 山形県東田川郡庄内町余目滑石３８−１',ordered:'山形県庄内町余目字滑石38-1',evidence:'Same 庄内町余目滑石38-1; map supplies 東田川郡 district omitted by official municipality address; 字 prefix representation only'},
 'genky-732':{actual:'〒525-0061 滋賀県草津市北山田町坊ノ後６９ １',ordered:'滋賀県草津市北山田町坊ノ後69番1',evidence:'Same official 草津市北山田町坊ノ後 and complete lot 69-1; map separates lot parts with whitespace'},
}
export function reviewedAddress(row,observation){
 const alias=reviewedRepresentations[row.id];assert(alias,'No individually reviewed address representation')
 assert.equal(observation.address,alias.actual,'Map representation changed since review')
 verifyMarkerAddress({coordinateEntityAddress:normalizeJapaneseStreet(alias.ordered)},{...row,address:normalizeJapaneseStreet(alias.officialAlternative?alias.ordered:row.address)})
 return alias
}
async function main(){
 const input='artifacts/drugstores-pending-reconciled-2026-10-03',out='artifacts/drugstores-pending-second-pass-2026-10-03'
 await mkdir(out,{recursive:true});const pending=JSON.parse(await readFile(input+'/pending.json','utf8')),pages=[]
 for(const dir of [input+'/cache','artifacts/drugstores-public-markers-2026-10-03/cache','artifacts/drugstores-genky-public-2026-10-03/cache','artifacts/drugstores-asahi-hashi-recovery-2026-10-03/cache']){try{for(const file of await readdir(dir)){try{const page=JSON.parse(await readFile(dir+'/'+file,'utf8'));pages.push({...page,cacheFile:dir+'/'+file})}catch{}}}catch{}}
 const stores=[],unresolved=[]
 for(const row of pending){let accepted,lastError='No individually verified equivalent address representation'
  for(const observation of row.unverifiedBusinessObservations||[]){try{
   const alias=reviewedAddress(row,observation);if(alias.officialAlternative){const proof=JSON.parse(await readFile(out+'/cache/ain-shapo-official-recruit.json','utf8'));assert(proof.html.includes('シャポー小岩店')&&proof.html.includes('7丁目24-1')&&proof.url===alias.sources[0],'Official alternative address proof missing')}const page=pages.find(p=>p.url===observation.mapUrl);assert(page,'Missing cached business map')
   const key=s=>s.normalize('NFKC').replace(/[\s＆&]/g,'').replace(/ぺ/g,'ペ').toLowerCase();assert(key(observation.name).includes(key(row.name)),'Business branch name differs')
   const parseRow={...row,name:observation.name,address:alias.ordered}
   let marker
   if(row.chain_name==='ゲンキー'){assert.equal(observation.website,new URL(row.sourceUrl).hostname.replace(/^www\./,''),'Business official website differs');marker=parseOfficialEmbedMarker(page.html,parseRow)}
   else marker=parseOfficialEmbedMarker(page.html,parseRow)
   assert.equal(marker.coordinateEntityId,observation.entityId)
   const {reason,reconciliationStatus,unverifiedBusinessObservations,reviewDisposition,...identity}=row
   accepted=validateStore({...identity,...marker,coordinateStatus:'verified-store-marker',coordinateAccuracy:'store-marker',coordinateVerification:'official-business-identity-reviewed-equivalent-address',coordinateEvidence:alias.evidence,coordinateAddressReviewed:alias.ordered,coordinateAddressEvidenceUrls:alias.sources||[row.sourceUrl],coordinateSourceUrl:page.url,coordinateCacheFile:page.cacheFile,coordinateCollectedAt:page.collectedAt});break
  }catch(e){lastError=e.message}}
  if(accepted){stores.push(accepted);console.log('verified',row.id)}else unresolved.push({...row,secondPassReason:lastError})
 }
 const report={generatedAt:new Date().toISOString(),inputCount:pending.length,verifiedCandidates:stores.length,pending:unresolved.length,applied:false,enumerationComplete:true}
 for(const [file,data]of Object.entries({'stores.json':stores,'pending.json':unresolved,'report.json':report}))await writeFile(out+'/'+file,JSON.stringify(data,null,2))
 console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
