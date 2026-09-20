import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql,robotsAllow} from './crawl-drugstores.mjs'

const base='https://sundrug-online.com',api=base+'/tools/locations/listings/search_v2.json'
const body={search:{listings_container_id:'listings',coords:[36,137],tags:[],location_result:false,open_now:false,max_results:2000,max_distance:3000,max_distance_units:'km',filter_behaviour:'all'}}
export function parseSundrugDirectory(s,collectedAt){
  assert(!/薬局|調剤/.test(s.name),'Dispensing department excluded; do not duplicate its retail branch')
  assert(!/閉店|休業|予定|近日|営業を中止|移転いたします/.test(s.name),'Closure or future opening requires review')
  assert(s.country?.name==='日本','Not a Japan store')
  assert(s.website?.match(/^https:\/\/sundrug-online\.com\/blogs\/search-store\/\d+$/),'Unexpected official store URL')
  assert(s.opening_hours?.some(h=>h.status==='open'&&h.opening_time&&h.closing_time),'No retail opening hours')
  const tags=s.tags.map(t=>t.title)
  assert(tags.some(t=>/資生堂|カネボウ|コーセー|ソフィーナ|食品|ドラッグストア|ペット用品|ベビー用品/.test(t)),'Retail classification unverified')
  return validateStore({id:`sundrug-${s.website.split('/').pop()}`,name:`サンドラッググループ ${s.name}`,chain_name:'サンドラッググループ',
    address:[s.region?.name,s.city?.name,s.address_line_1,s.address_line_2].filter(Boolean).join(''),city:s.city?.name||'',
    lat:s.lat,lng:s.lng,phone:s.phone_number||'',taxFree:tags.some(t=>/免税/.test(t))?true:null,
    hours:s.opening_hours.map(h=>`${h.day} ${h.status==='open'?`${h.opening_time?.slice(11,16)}–${h.closing_time?.slice(11,16)}`:'休業'}`).join('; '),
    sourceUrl:s.website,sourceApiUrl:api,sourceStoreCode:s.id,coordinateEvidence:'Official store locator lat/lng fields',collectedAt})
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-sundrug-directory-2026-09-13'
  const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume')
  const get=await createFetcher(out,offline,resume),directory=await get(base+'/tools/locations/directory')
  const expected=Number(directory.html.match(/countries\/japan">日本\s*\((\d+)\)/)?.[1])
  assert(expected>0,'Missing official directory total')
  let saved
  if(offline||resume){try{saved=JSON.parse(await readFile(`${out}/search-response.json`,'utf8'))}catch{assert(!offline,'No offline search response')}}
  if(!saved){
    const robots=await get(base+'/robots.txt');assert(robotsAllow(robots.html,api),'robots.txt disallows search')
    const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'AAPriceCatalog/1.0'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
    assert(response.ok,`Search HTTP ${response.status}`)
    saved={url:api,body,status:response.status,collectedAt:new Date().toISOString(),html:await response.text()}
    await writeFile(`${out}/search-response.json`,JSON.stringify(saved))
  }
  const data=JSON.parse(saved.html).locations
  assert.equal(data.length,expected,'Search result does not cover official directory total')
  assert.equal(new Set(data.map(s=>s.website)).size,data.length,'Duplicate official source codes')
  const stores=[],excluded=[]
  for(const row of data){try{stores.push(parseSundrugDirectory(row,saved.collectedAt))}catch(e){excluded.push({id:row.id,name:row.name,sourceUrl:row.website,reason:e.message})}}
  const report={generatedAt:new Date().toISOString(),collectedAt:saved.collectedAt,source:api,expected,discovered:data.length,accepted:stores.length,excluded:excluded.length,enumerationComplete:true,applied:false,
    note:'Group directory; individual affiliate brand not inferred from branch names. Pharmacy departments and future openings excluded.'}
  for(const [file,value] of Object.entries({'stores.json':stores,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores))
  console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
