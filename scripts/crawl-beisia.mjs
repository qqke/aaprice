import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'

export function parseBeisiaBranch(html,url,collectedAt) {
  const body=html.match(/<script>const storelocator = ([\s\S]*?)<\/script>/)?.[1]
  assert(body,'Missing official branch payload')
  const payload=body.split("storelocator['point']['point'] = ")[1]
  assert(payload,'Missing exact branch data')
  const point=JSON.parse(payload.trim().replace(/;$/,''))
  assert.equal(point.key,new URL(url).pathname.split('/').at(-1),'Branch URL identity differs')
  assert(point.name&&point.address,'Missing branch identity')
  if(point.extra_fields?.['取扱商品_医薬品']!=='1')return null
  const schema=JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1]||'null')
  assert.equal(schema?.['@type'],'Store')
  assert.equal(schema.name,point.name)
  assert.equal(schema.address.streetAddress,point.address)
  assert.equal(schema.telephone,point.extra_fields['電話番号'])
  assert.equal(schema.geo.latitude,point.latitude)
  assert.equal(schema.geo.longitude,point.longitude)
  return validateStore({id:'beisia-otc-'+point.key,name:point.name,address:point.address,chain_name:'ベイシア',
    phone:point.extra_fields['電話番号'],hours:point.extra_fields['営業時間'],lat:point.latitude,lng:point.longitude,
    sourceUrl:url,collectedAt,retailEvidence:'Exact official branch medicine handling field equals 1',
    coordinateSourceUrl:url,coordinateCollectedAt:collectedAt,coordinateStatus:'verified-store-marker'})
}

async function main() {
  const out=process.argv.find(s=>s.startsWith('--out='))?.slice(6)||'artifacts/drugstores-beisia-refresh'
  const get=await createFetcher(out,false,process.argv.includes('--resume')),site=await get('https://map.beisia.co.jp/sitemap.xml')
  const urls=[...site.html.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]).filter(u=>/^https:\/\/map\.beisia\.co\.jp\/points\/\d+$/.test(u))
  assert(urls.length,'Empty official branch sitemap');assert.equal(new Set(urls).size,urls.length)
  const stores=[],excluded=[],failures=[]
  for(const url of urls) {
    try {
      const p=await get(url),row=parseBeisiaBranch(p.html,url,p.collectedAt)
      // shortcut: point fields do not prove independent tenant identity or current operation; review before import.
      if(row)stores.push(row)
      else excluded.push({sourceUrl:url,collectedAt:p.collectedAt,reason:'Exact branch medicine field is not 1'})
    }catch(error){failures.push({url,reason:error.message})}
    for(const [file,value]of Object.entries({'stores.json':stores,'excluded.json':excluded,'failures.json':failures}))
      await writeFile(out+'/'+file,JSON.stringify(value,null,2))
    console.log(JSON.stringify({processed:stores.length+excluded.length+failures.length,total:urls.length,otc:stores.length}))
  }
  await writeFile(out+'/report.json',JSON.stringify({generatedAt:new Date().toISOString(),source:site.url,
    discovered:urls.length,otc:stores.length,notOTC:excluded.length,failures:failures.length,
    enumerationComplete:failures.length===0,identityReviewRequired:true,applied:false,nationalComplete:false},null,2))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
