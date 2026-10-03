import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {parseAobado,parseKashiwaba,parseAxis} from './crawl-membership-retail-a.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-membership-retail-a-2026-10-03',stores=JSON.parse(await readFile(out+'/stores.json','utf8')),fresh=[]
for(const[id,parser]of [['aobadokansai',parseAobado],['aobadookayama',parseAobado],['aobadoyamaguchi',parseAobado],['kashiwaba',parseKashiwaba]]){const p=JSON.parse(await readFile(out+'/cache/'+id+'.json','utf8'));fresh.push(...parser(p.html,p.url))}
for(const id of ['axis_iwami','axis_city','axis_yume']){const p=JSON.parse(await readFile(out+'/cache/'+id+'.json','utf8'));fresh.push(parseAxis(p.html,p.url))}
const checks=[]
for(const s of stores){
 validateStore(s)
 const official=fresh.find(x=>x.id===s.id)
 if(official){assert.equal(official.name,s.name);assert.equal(official.address,s.address);assert.equal(official.phone,s.phone);assert.equal(official.reason||null,null)}
 else if(s.id==='kiyama-hokubu'){const p=JSON.parse(await readFile(out+'/cache/kiyama-hokubu.json','utf8'));assert(p.html.includes('0969-24-2366'));assert(p.html.includes('八幡町1-1'))}
 else assert(s.id.startsWith('sasaki-')&&s.sourceDirectoryUrl==='https://www.uchiyama-sasaki.com/')
 const p=JSON.parse(await readFile(out+'/cache/marker-'+createHash('sha256').update(s.coordinateSourceUrl).digest('hex')+'.json','utf8'))
 const marker=parseOfficialEmbedMarker(p.html,{...s,name:s.name.replaceAll('・','').replace(/[（(][^）)]*[）)]/g,'').replaceAll('⻄','西')})
 verifyMarkerAddress(marker,{...s,address:normalizeAddress(s.address)});assert.equal(marker.lat,s.lat);assert.equal(marker.lng,s.lng)
 checks.push({id:s.id,sourceIdentity:official?'independently re-parsed official branch':s.id==='kiyama-hokubu'?'exact official OTC phone/street':'company exact retail branch plus government/manufacturer identity supplement',phoneNameStreetMarker:true})
}
await writeFile(out+'/verification.json',JSON.stringify({generatedAt:new Date().toISOString(),checked:checks.length,allPassed:true,checks},null,2));console.log('Verified '+checks.length+' strict entity markers')
