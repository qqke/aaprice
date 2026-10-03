import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
const digits=s=>{const raw=String(s||'').normalize('NFKC'),value=raw.replace(/\D/g,'');return /^81\d{9,10}$/.test(value)?'0'+value.slice(2):value}
function embedEntities(html){
  const json=html.match(/initEmbed\((\[[\s\S]*?\])\);/)?.[1]
  assert(json,'No embedded map entity payload')
  const candidates=[]
  function visit(value){
    if(!Array.isArray(value))return
    const identity=value[0]
    if(Array.isArray(identity)&&typeof identity[0]==='string'&&/^0x[\da-f]+:0x[\da-f]+$/i.test(identity[0])&&Array.isArray(identity[2])&&identity[2].length===2&&identity[2].every(Number.isFinite))candidates.push(value)
    for(const item of value)visit(item)
  }
  visit(JSON.parse(json))
  return candidates
}
export function parseOfficialEmbedMarker(html,row){
  const candidates=embedEntities(html)
  const phone=digits(row.phone)
  const matched=candidates.filter(entity=>phone.length>=9&&entity.some(value=>typeof value==='string'&&digits(value)===phone))
  assert.equal(matched.length,1,'Embedded map must identify exactly one entity with matching official phone')
  const normalized=s=>s.normalize('NFKC').replace(/\s/g,'')
  const entity=matched[0],name=normalized(row.name.replace(/^ドラッグストアモリ\s*|^ザグザグ\s*/,''))
  assert(entity.some(value=>typeof value==='string'&&normalized(value).includes(name)),'Embedded map entity name differs from official store')
  return {lat:entity[0][2][0],lng:entity[0][2][1],coordinateEvidence:'Official embedded map entity marker; official phone and store name matched',coordinateEntityId:entity[0][0],coordinateEntityAddress:entity[13]||'',coordinateEntityName:entity[1]}
}
export async function getOfficialEmbedMarker(detailHtml,row,out,{offline=false,resume=false}={}){
  const raw=detailHtml.match(/<iframe[^>]+src="(https:\/\/www\.google\.com\/maps\/embed[^"<>]*)"/)?.[1]
  assert(raw,'No official Google Maps embed')
  const url=raw.replace(/&amp;|&#038;?/g,'&'),file=`${out}/cache/embed-${createHash('sha256').update(url).digest('hex')}.json`
  await mkdir(`${out}/cache`,{recursive:true})
  let page
  try{const cached=JSON.parse(await readFile(file,'utf8'));if(offline||resume||Date.now()-Date.parse(cached.collectedAt)<86400000)page=cached}catch{}
  if(!page){
    assert(!offline,'No cached official embedded map')
    const response=await fetch(url,{headers:{Referer:new URL(row.sourceUrl).href,'User-Agent':'AAPriceCatalog/1.0 (public drugstore directory)'},signal:AbortSignal.timeout(25000)})
    assert(response.ok,`Official embedded map HTTP ${response.status}`)
    page={url,sourceUrl:row.sourceUrl,collectedAt:new Date().toISOString(),html:await response.text()}
    await writeFile(file,JSON.stringify(page))
  }
  return {...parseOfficialEmbedMarker(page.html,row),coordinateSourceUrl:url,coordinateCollectedAt:page.collectedAt}
}
export function verifyMarkerAddress(marker,row){
  const normalize=s=>String(s||'').normalize('NFKC').replace(/〒\s*\d{3}-?\d{4}/g,'').replace(/\s/g,'')
  const official=normalize(row.address),actual=normalize(marker.coordinateEntityAddress)
  const locality=official.match(/^(?:東京都|北海道|大阪府|京都府|.{2,3}県)[^\d]+?[市区町村]/)?.[0]
  assert(locality&&actual.includes(locality),'Public business marker locality differs from official address')
  const streetNumbers=s=>(String(s||'').normalize('NFKC').replace(/〒\s*\d{3}-?\d{4}/g,'').replace(/[Bb]?\d+\s*[Ff階]/g,'').match(/\d+(?:[-‐‑–—−ー丁目番地号条東西南北の]+\s*\d+)*/)?.[0].match(/\d+/g)||[])
  const numbers=streetNumbers(row.address),mapNumbers=streetNumbers(marker.coordinateEntityAddress)
  assert(numbers.length>0,'Official address has no building/street numbers for verification')
  assert.equal(numbers.join('-'),mapNumbers.join('-'),'Public business marker street/building numbers differ from official address')
}
export function parseWebsiteVerifiedMarker(html,row){
  const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s/g,'')
  const domain=new URL(row.sourceUrl).hostname.replace(/^www\./,''),name=normalize(row.name.replace(/^ドラッグストアモリ\s*|^ザグザグ\s*/,''))
  const matched=embedEntities(html).filter(entity=>Array.isArray(entity[11])&&String(entity[11][1]).replace(/^www\./,'')===domain&&normalize(entity[1]).includes(name))
  assert.equal(matched.length,1,'Public marker must have matching official website and exact branch name')
  const entity=matched[0],marker={lat:entity[0][2][0],lng:entity[0][2][1],coordinateEntityId:entity[0][0],coordinateEntityAddress:entity[13]||'',coordinateEntityName:entity[1],coordinateEntityWebsite:entity[11][1],coordinateVerification:'official-website-business-name-address'}
  verifyMarkerAddress(marker,row)
  return marker
}
export function parseOfficialFeatureMarker(html,mapUrl,row){
  const feature=decodeURIComponent(mapUrl).match(/!1s(0x[\da-f]+:0x[\da-f]+)/)?.[1]
  assert(feature,'Official map does not explicitly select a business feature')
  const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s/g,'')
  const name=normalize(row.name.replace(/^ドラッグストアモリ\s*|^ザグザグ\s*/,''))
  const matched=embedEntities(html).filter(entity=>entity[0][0]===feature&&normalize(entity[1]).includes(name))
  assert.equal(matched.length,1,'Official selected business feature and exact branch name must match')
  const entity=matched[0],marker={lat:entity[0][2][0],lng:entity[0][2][1],coordinateEntityId:entity[0][0],coordinateEntityAddress:entity[13]||'',coordinateEntityName:entity[1],coordinateVerification:'official-feature-business-name-address',officialEmbedUrl:mapUrl}
  verifyMarkerAddress(marker,row)
  return marker
}
