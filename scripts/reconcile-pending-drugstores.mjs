import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {parseEmbeddedMarker} from './crawl-missing-chains.mjs'
import {databaseProcess} from './sync-sundrug.mjs'
import {canonicalStoreIdentity} from './drugstore-identity.mjs'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseOfficialEmbedMarker,parseWebsiteVerifiedMarker,parseOfficialFeatureMarker,verifyMarkerAddress} from './official-embed-marker.mjs'

export function normalizeJapaneseStreet(value){
  const digits={'〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
  return String(value||'').normalize('NFKC').replace(/([〇零一二三四五六七八九十]+)(?=丁目|番地?|号|条)/g,(_,s)=>s.includes('十')?String((digits[s.split('十')[0]]||1)*10+(digits[s.split('十')[1]]||0)):s.split('').map(c=>digits[c]).join(''))
}
const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
const nameKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s＆&]/g,'').replace(/ぺ/g,'ペ')
function branch(row){return row.name.replace(/^ドラッグストアモリ\s*|^ザグザグ\s*|^クスリのサンロード\s*|^サンキュードラッグ\s*|^アインズ[＆&]トル[ペぺ]\s*(?:Family\s*)?|^スーパードラッグアサヒ\s*|^ドラッグストア木のうた\s*|^シモカワ\s*|^くすりのダイイチ(?:薬局)?\s*|^ゲンキー\s*/,'').normalize('NFKC')}
function businessObservations(page,queryName){
  const found=[]
  try{
    const json=page.html.match(/initEmbed\((\[[\s\S]*?\])\);/)?.[1]
    function visit(v){
      if(!Array.isArray(v))return
      if(Array.isArray(v[0])&&/^0x[\da-f]+:0x[\da-f]+$/i.test(v[0][0])&&Array.isArray(v[0][2])&&typeof v[1]==='string'&&nameKey(v[1]).includes(nameKey(queryName)))found.push({entityId:v[0][0],name:v[1],address:v[13]||'',phone:v[7]||'',website:v[11]?.[1]||'',mapUrl:page.url,cacheFile:page.cacheFile||null})
      for(const item of v)visit(item)
    }
    visit(JSON.parse(json))
  }catch{}
  return found
}
const alternateAddresses={
  'ainz-0091':{address:'北海道札幌市中央区南1条西27丁目1-1 マルヤマクラスB1F',sources:['https://maruyama-class.com/shop/ainz','https://maruyama-class.com/access?newwindow=true']},
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-pending-reconciled-2026-10-03'
  const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume')
  await mkdir(`${out}/cache`,{recursive:true})
  const original=JSON.parse(await readFile('artifacts/drugstores-audit-final-2026-10-03/pending-ledger.json','utf8'))
  let database
  if(offline&&!process.argv.includes('--refresh-db'))database=JSON.parse(await readFile(`${out}/database-before.json`,'utf8'))
  else{process.loadEnvFile('.env');const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from(select id,name,chain_name,address,pref,city,lat,lng,hours from public.stores order by id) s;");database=JSON.parse(raw.slice(raw.indexOf('[')));await writeFile(`${out}/database-before.json`,JSON.stringify(database,null,2))}
  const byId=new Map(database.map(row=>[row.id,row])),byIdentity=new Map(database.map(row=>[canonicalStoreIdentity(row),row]))
  const mapPages=[]
  const cacheDirs=new Set([`${out}/cache`,'artifacts/drugstores-public-markers-2026-10-03/cache','artifacts/drugstores-genky-public-2026-10-03/cache','artifacts/drugstores-additional-chains-2026-10-03/cache','artifacts/drugstores-komeya-recovery-2026-10-03/cache','artifacts/drugstores-asahi-hashi-recovery-2026-10-03/cache'])
  for(const row of original)for(const path of [row.sourceArtifact,row.artifact])if(path)cacheDirs.add(path.replace(/\/[^/]+$/,'')+'/cache')
  for(const dir of cacheDirs){let files=[];try{files=await readdir(dir)}catch{};for(const file of files){try{const page=JSON.parse(await readFile(`${dir}/${file}`,'utf8'));if(/google\.[^/]+\/maps/.test(page.url)&&/initEmbed\(/.test(page.html))mapPages.push({...page,cacheFile:`${dir}/${file}`})}catch{}}}
  const get=await createFetcher(out,offline,resume),stores=[],pending=[],excluded=[],matched=[],delegated=[]
  async function save(complete){
    const report={generatedAt:new Date().toISOString(),databaseRows:database.length,discovered:original.length,processed:stores.length+pending.length+excluded.length+matched.length+delegated.length,verifiedCandidates:stores.length,pending:pending.length,excluded:excluded.length,matchedExisting:matched.length,delegated:delegated.length,enumerationComplete:complete,applied:false}
    for(const [file,value]of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'matched-existing.json':matched,'delegated.json':delegated,'report.json':report,'reconciliation-ledger.json':[...stores.map(row=>({...row,reconciliationStatus:'verified-candidate'})),...pending,...excluded,...matched,...delegated]}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  }
  for(const raw of original){
    let row={...raw}
    if(!row.id||!row.name||!row.address){delegated.push({...row,reconciliationStatus:'delegated-enumeration',reason:'Directory enumeration/identity gap owned by another agent'});continue}
    const existing=byId.get(row.id)||byIdentity.get(canonicalStoreIdentity(row))
    if(existing){matched.push({...row,reconciliationStatus:'matched-existing',databaseIds:[existing.id],databaseAddress:existing.address,databaseCoordinates:{lat:existing.lat,lng:existing.lng},reason:'Current database contains exact source ID or canonical branch identity'});continue}
    if(/^ryuseido-/.test(row.id)){delegated.push({...row,reconciliationStatus:'delegated-retail-classification',reason:'Ryuseido category audit owned by another agent; no repeated crawl'});continue}
    if(/^zagzag-/.test(row.id)&&/調剤/.test(row.name)){excluded.push({...row,reconciliationStatus:'out-of-retail-scope',reason:'Official branch title explicitly identifies a dispensing pharmacy, not a retail drugstore'});continue}
    if(/Express|スーパーシティ/.test(row.name)){pending.push({...row,reconciliationStatus:'retail-classification-unresolved',reason:'Retail assortment classification still requires official evidence'});continue}
    if(row.address.startsWith('北広島市'))row={...row,address:'北海道'+row.address,addressEvidence:'Official named municipality Kitahiroshima; Hokkaido resolved and checked against mall official address'}
    if(row.address.startsWith('西牟婁郡上富田町'))row={...row,address:'和歌山県'+row.address,addressEvidence:'Official named municipality Kamitonda, Nishimuro; Wakayama prefecture'}
    if(row.source==='ohga'&&!/^ohga-/.test(row.id))row.id='ohga-'+row.id
    const alternate=alternateAddresses[row.id]
    if(alternate)row={...row,officialDirectoryAddress:row.address,address:alternate.address,addressEvidence:'Facility official tenant page confirms same phone and facility official access page publishes residential address',addressEvidenceUrls:alternate.sources}
    let officialHtml='',officialMap=''
    for(const artifact of [row.sourceArtifact,row.artifact,row.chain_name==='ゲンキー'?'artifacts/drugstores-genky-2026-10-03/pending.json':null,row.chain_name==='コメヤ薬局'?'artifacts/drugstores-missing-chains-2026-10-03/pending.json':null]){
      if(!artifact)continue;const dir=artifact.replace(/\/[^/]+$/,'')
      try{officialHtml=JSON.parse(await readFile(`${dir}/cache/${createHash('sha256').update(row.sourceUrl).digest('hex')}.json`,'utf8')).html;break}catch{}
    }
    if(!officialHtml&&row.sourceUrl&&!offline){try{officialHtml=(await get(row.sourceUrl)).html}catch{}}
    officialHtml=officialHtml.replace(/<!--[\s\S]*?-->/g,'')
    officialMap=officialHtml.match(/<iframe[^>]+src="(https:\/\/[^"<>]*google\.[^"<>]*maps[^"<>]*)"/)?.[1]?.replace(/&amp;|&#038;?/g,'&')||''
    let queryName=branch(row),identityEvidence=[]
    if(row.id.startsWith('drug39-')&&/label_service_a">ドラッグ/.test(officialHtml)&&/薬局$/.test(queryName)){queryName=queryName.replace(/薬局$/,'');identityEvidence.push('Official branch has an explicit active ドラッグ department; pharmacy suffix removed for retail business identity with exact retail department phone')}
    const addressRow={...row,address:normalizeJapaneseStreet(row.address)}
    const parseRow={...addressRow,name:queryName}
    const failures=[],observations=[]
    const cached=mapPages.filter(page=>{const q=new URL(page.url).searchParams.get('q')||'';return nameKey(q).includes(nameKey(queryName))||nameKey(q).includes(nameKey(row.name))||page.sourceUrl===row.sourceUrl})
    const queries=[`${row.name} ${row.phone||''}`,row.id.startsWith('drug39-')?`サンキュードラッグ ${queryName}店 ${row.phone}`:row.name]
    let accepted
    if(row.chain_name==='ゲンキー'&&officialMap){try{const point=parseOfficialCoordinateQuery(officialMap);const {reason,directMarkerReason,...identity}=row;accepted=validateStore({...identity,...point,coordinateSourceUrl:officialMap,coordinateStatus:'verified-store-marker',coordinateAccuracy:'store-marker',coordinateEvidence:'Official retail detail map explicitly plots the numeric q coordinate as its point marker',coordinateVerification:'official-detail-explicit-coordinate-query'});console.log('official plotted point',row.id)}catch{}}
    for(let attempt=0;attempt<cached.length+queries.length&&!accepted;attempt++){
      let page=cached[attempt]
      if(!page){
        const q=queries[attempt-cached.length],url=new URL('https://www.google.com/maps');url.search=new URLSearchParams({q,output:'embed',hl:'ja'})
        const file=`${out}/cache/public-${createHash('sha256').update(url.href).digest('hex')}.json`
        try{page=JSON.parse(await readFile(file,'utf8'))}catch{if(offline){failures.push('No cached public query: '+q);continue}try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});assert(response.ok,`Map HTTP ${response.status}`);page={url:url.href,collectedAt:new Date().toISOString(),html:await response.text()};await writeFile(file,JSON.stringify(page));await new Promise(r=>setTimeout(r,1000))}catch(e){failures.push(e.message);continue}}
      }
      observations.push(...businessObservations(page,queryName))
      try{
        let marker,method='official-phone-business-name-address'
        if(row.chain_name!=='ゲンキー')try{marker=parseOfficialEmbedMarker(page.html,parseRow)}catch(e){failures.push(e.message.split('\n')[0])}
        if(!marker)try{marker=parseWebsiteVerifiedMarker(page.html,parseRow);method='official-website-business-name-address'}catch(e){failures.push(e.message.split('\n')[0])}
        if(!marker&&officialMap)try{marker=parseOfficialFeatureMarker(page.html,officialMap,parseRow);method='official-feature-business-name-address'}catch(e){failures.push(e.message.split('\n')[0])}
        if(!marker&&officialMap&&row.chain_name==='ゲンキー')try{const selected=parseEmbeddedMarker(page.html,officialMap),label=nameKey(selected.markerAddress),city=normalizeJapaneseStreet(row.address).match(/^(?:東京都|北海道|大阪府|京都府|.{2,3}県)(.+?[市区町村郡])/)?.[1];assert((label.includes('ゲンキー')||label.includes('genky'))&&label.includes(nameKey(queryName))&&city&&label.includes(nameKey(city)),'Official selected Genky entity branch/locality differs');marker={...selected,coordinateEntityId:selected.mapFeature,coordinateEntityName:selected.markerAddress,coordinateEntityAddress:selected.markerAddress};method='official-selected-business-feature-cadastral-address'}catch(e){failures.push(e.message.split('\n')[0])}
        assert(marker,'No exact official business identity match')
        marker.coordinateEntityAddress=normalizeJapaneseStreet(marker.coordinateEntityAddress)
        if(row.id==='ainz-0142'){
          assert(/北海道千歳市/.test(marker.coordinateEntityAddress)&&/新千歳空港/.test(marker.coordinateEntityAddress)&&/国際線/.test(marker.coordinateEntityAddress)&&/3F|3階/.test(marker.coordinateEntityAddress),'Airport terminal/floor differs')
          identityEvidence.push('Official airport tenant directory confirms business phone and international departures terminal 3F; no civic street number is assigned to this airport tenant')
          row.addressEvidenceUrls=['https://www.hokkaido-airports.com/ja/new-chitose/spend/shop/246/',row.sourceUrl]
          method='official-phone-airport-terminal-floor'
        }else if(method!=='official-selected-business-feature-cadastral-address')verifyMarkerAddress(marker,addressRow)
        const {reason,reconciliationStatus,databaseIdPresent,...identity}=row
        accepted=validateStore({...identity,...marker,coordinateStatus:'verified-store-marker',coordinateAccuracy:'store-marker',coordinateVerification:method,coordinateEvidence:method+'; Japanese numeric street descriptors normalized without changing numeric values',coordinateSourceUrl:page.url,coordinateCollectedAt:page.collectedAt,identityEvidence})
      }catch(e){failures.push(e.message.split('\n')[0])}
    }
    if(accepted){stores.push(accepted);console.log('verified',row.id,row.name)}
    else pending.push({...row,reconciliationStatus:'unresolved',reason:[...new Set(failures)].join('; '),identityEvidence,officialMapUrl:officialMap||null,unverifiedBusinessObservations:[...new Map(observations.map(o=>[o.entityId,o])).values()],reviewDisposition:'Identity/address evidence insufficient; do not assume closed or import coordinates'})
    const done=stores.length+pending.length+excluded.length+matched.length+delegated.length
    if(done%10===0){await save(false);console.log(`Reconcile ${done}/${original.length}: ${stores.length} verified, ${pending.length} unresolved, ${matched.length} existing`)}
  }
  await save(true)
  console.log(JSON.stringify({out,discovered:original.length,verified:stores.length,pending:pending.length,excluded:excluded.length,matched:matched.length,delegated:delegated.length}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
export function parseOfficialCoordinateQuery(mapUrl){
  const url=new URL(mapUrl)
  assert(/^(?:www\.|maps\.)?google\.(?:com|co\.jp)$/.test(url.hostname)&&url.searchParams.get('output')==='embed','Not an official detail point embed')
  const point=url.searchParams.get('q')?.trim().match(/^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/)
  assert(point,'Official map query does not explicitly identify a coordinate point')
  const lat=Number(point[1]),lng=Number(point[2]);assert(lat>=20&&lat<=46&&lng>=122&&lng<=154,'Point outside Japan')
  return {lat,lng}
}
