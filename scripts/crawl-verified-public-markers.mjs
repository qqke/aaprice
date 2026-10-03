import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {parseOfficialEmbedMarker,verifyMarkerAddress,parseWebsiteVerifiedMarker,parseOfficialFeatureMarker} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-public-markers-2026-10-03'
const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume')
await mkdir(`${out}/cache`,{recursive:true})
const missingOnly=process.argv.includes('--sources=missing-chains')
const nationalOnly=process.argv.includes('--sources=national-two')
const sources=nationalOnly?[['national-two','pending.json']]:missingOnly?[['missing-chains','pending.json']]:[['fitcare-ainz','pending.json'],['sunroad','pending.json'],['mori','pending.json'],['zagzag','pending-coordinates.json'],['mac','pending.json'],['yamazawa','pending.json'],['drug39','pending.json'],['arka','pending.json']]
const rows=[]
for(const [chain,file] of sources){let values=JSON.parse(await readFile(`artifacts/drugstores-${chain}-2026-10-03/${file}`,'utf8'));if(missingOnly)values=values.filter(row=>/^asahi-|^hashi-/.test(row.id||'')).map(row=>{if(!row.id.startsWith('hashi-'))return row;const retailPhone=row.phone.match(/ドラッグストア部門[^]*?(0[\d-]{9,13})/)?.[1];const prefix=row.address.startsWith('福島市')?'福島県':'';return {...row,phone:retailPhone||row.phone,address:prefix+row.address,...(prefix?{addressEvidence:'Official address names Fukushima municipality; prefecture resolved from municipality'}:{})}});rows.push(...values.map(row=>({...row,sourceArtifact:`artifacts/drugstores-${chain}-2026-10-03/${file}`})))}
const accepted=[],pending=[]
async function save(complete){
  for(const [file,value] of Object.entries({'stores.json':accepted,'pending.json':pending,'report.json':{generatedAt:new Date().toISOString(),discovered:rows.length,processed:accepted.length+pending.length,accepted:accepted.length,pending:pending.length,enumerationComplete:complete,applied:false,verification:'Business entity branch/locality/street numbers matched plus official phone, official business website, or exact officially selected business feature'}}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],accepted))
}
for(const row of rows){
  try{
    assert(!missingOnly||!/Express|スーパーシティ/.test(row.name),'Non-standard supermarket/convenience format requires retail classification review')
    const url=new URL('https://www.google.com/maps');url.searchParams.set('q',process.argv.includes('--name-only')?row.name:`${row.name} ${row.address}`);url.searchParams.set('output','embed');url.searchParams.set('hl','ja')
    const file=`${out}/cache/${createHash('sha256').update(url.href).digest('hex')}.json`
    let page
    try{const cached=JSON.parse(await readFile(file,'utf8'));if(offline||resume||Date.now()-Date.parse(cached.collectedAt)<86400000)page=cached}catch{}
    if(!page){assert(!offline,'No offline public map cache');const response=await fetch(url,{signal:AbortSignal.timeout(25000)});assert(response.ok,`Public map HTTP ${response.status}`);page={url:url.href,collectedAt:new Date().toISOString(),html:await response.text()};await writeFile(file,JSON.stringify(page));await new Promise(r=>setTimeout(r,1000))}
    const queryName=row.name.replace(/^クスリのサンロード\s*|^サンキュードラッグ\s*|^アインズ[＆&]トルペ\s*(?:Family\s*)?|^スーパードラッグアサヒ\s*/,'')
    let marker
    try{marker=parseOfficialEmbedMarker(page.html,{...row,name:queryName})}
    catch(phoneFailure){
      try{marker=parseWebsiteVerifiedMarker(page.html,{...row,name:queryName})}
      catch(websiteFailure){
        const directory=row.sourceArtifact.replace(/\/[^/]+$/,'')
        let officialHtml=''
        try{
          if(row.id.startsWith('mac-')){const search=JSON.parse(await readFile(directory+'/search.json','utf8'));officialHtml=search.data.html.split('<div class="store-item">').find(block=>block.includes(row.name)&&block.includes(row.phone))||''}
          else{officialHtml=JSON.parse(await readFile(directory+'/cache/'+createHash('sha256').update(row.sourceUrl).digest('hex')+'.json','utf8')).html}
        }catch{}
        const officialMap=officialHtml.match(/<iframe[^>]+src="(https:\/\/www\.google\.com\/maps\/embed[^"<>]*)"/)?.[1]?.replace(/&amp;|&#038;?/g,'&')
        try{marker=parseOfficialFeatureMarker(page.html,officialMap||'',{...row,name:queryName})}
        catch(featureFailure){throw Error(phoneFailure.message+'; website fallback: '+websiteFailure.message+'; official feature fallback: '+featureFailure.message)}
      }
    }
    verifyMarkerAddress(marker,row)
    const {reason,...identity}=row
    accepted.push(validateStore({...identity,...marker,coordinateStatus:'verified-store-marker',coordinateAccuracy:'store-marker',coordinateEvidence:marker.coordinateVerification==='official-feature-business-name-address'?'Officially selected business feature marker matched branch name, municipality and street/building numbers':marker.coordinateVerification==='official-website-business-name-address'?'Public business entity marker matched official website, branch name, municipality and street/building numbers':'Public business entity marker matched official phone, branch name, municipality and street/building numbers',coordinateSourceUrl:page.url,coordinateCollectedAt:page.collectedAt}))
  }catch(e){pending.push({...row,reason:e.message})}
  if((accepted.length+pending.length)%20===0){await save(false);console.log(`Public marker ${accepted.length+pending.length}/${rows.length}: accepted ${accepted.length}, pending ${pending.length}`)}
}
await save(true)
console.log(JSON.stringify({out,discovered:rows.length,accepted:accepted.length,pending:pending.length}))
