import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const arg=(key,fallback)=>process.argv.find(s=>s.startsWith('--'+key+'='))?.slice(key.length+3)||fallback
const offset=Number(arg('offset','100')),limit=Number(arg('limit','300'))
const source='artifacts/drugstores-keimeido-retailers-2026-10-03',out=arg('out','artifacts/drugstores-keimeido-segment-a-2026-10-03')
const hash=s=>createHash('sha256').update(s).digest('hex'),text=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().normalize('NFKC')
const input=await readFile(source+'/unmatched-frozen.json','utf8'),selected=JSON.parse(input).slice(offset,offset+limit),report=JSON.parse(await readFile(out+'/report.json','utf8')),stores=JSON.parse(await readFile(out+'/stores.json','utf8')),attempts=JSON.parse(await readFile(out+'/attempts.json','utf8')),audit=[],pages=new Map()
assert.equal(report.inputSha256,hash(input));assert.equal(report.offset,offset);assert.equal(report.selected,limit);assert.equal(attempts.length,limit);assert.equal(new Set(attempts.map(x=>x.id)).size,limit)
const expectedIds=new Set(selected.map(x=>x.id));assert(attempts.every(x=>expectedIds.has(x.id)),'Attempt outside fixed selected range')
assert.equal(selected.length,limit);const expected=new Set(selected.map(x=>x.id));for(const attempt of attempts)assert(expected.has(attempt.id),'Attempt outside fixed slice')
for(const s of stores){
 const frozen=selected.find(x=>x.id===s.id);assert(frozen,'Candidate outside fixed slice')
 if(!pages.has(s.sourceUrl))pages.set(s.sourceUrl,JSON.parse(await readFile(source+'/cache/'+hash(s.sourceUrl)+'.json','utf8')))
 const page=pages.get(s.sourceUrl),blocks=[...page.html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(x=>x[1])
 const cells=block=>Object.fromEntries([...block.matchAll(/<td class="(shop_name|address|phone)">([\s\S]*?)<\/td>/g)].map(x=>[x[1],text(x[2])]))
 const matched=blocks.filter(block=>{const c=cells(block);return c.shop_name===s.name&&c.address===s.address&&c.phone===s.phone});assert.equal(matched.length,1,'Source must contain one exact identity row')
 assert(/src="[^"]*item[123]_(?:stock|order)\.png"/.test(matched[0]),'Exact row lacks OTC stock/order proof')
 for(const key of ['name','address','phone'])assert.equal(frozen[key],s[key])
 assert.equal(s.id,'keimeido-'+hash(s.name+'|'+normalizeAddress(s.address)).slice(0,16))
 const markerPage=JSON.parse(await readFile(out+'/cache/'+hash(s.coordinateSourceUrl)+'.json','utf8')),marker=parseOfficialEmbedMarker(markerPage.html,s);verifyMarkerAddress(marker,{...s,address:normalizeAddress(s.address)})
 assert(!/閉業|permanently closed/.test(markerPage.html));assert.equal(marker.lat,s.lat);assert.equal(marker.lng,s.lng);validateStore(s)
 audit.push({id:s.id,sourceUrl:s.sourceUrl,primaryRowReparsed:true,sourceStockOrOrder:true,phoneNameStreetEntity:true,entityId:marker.coordinateEntityId})
}
assert.equal(stores.length,attempts.filter(x=>x.status==='accepted').length)
await writeFile(out+'/verification.json',JSON.stringify({generatedAt:new Date().toISOString(),inputSha256:hash(input),offset,selected:limit,checked:stores.length,allPassed:true,audit},null,2));console.log(JSON.stringify({selected:limit,verified:stores.length,allPassed:true}))
