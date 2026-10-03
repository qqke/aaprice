import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'

const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-regional-2026-10-03'
const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const stores=[],pending=[],coverage={},failures=[]
const sources={
  yacs:async()=>{
    const url='https://yacs.jp/search/?store_cat%5B%5D=drug_store&all_store=true',page=await get(url)
    const rows=[...page.html.matchAll(/<li data-title="([^"]+)" data-link="([^"]+)" data-add="([^"]+)"[^>]*data-lon="([\d.]+)" data-lat="([\d.]+)"/g)]
    assert(rows.length>0,'Empty YACS retail directory')
    for(const [,name,sourceUrl,address,lng,lat] of rows)stores.push(validateStore({id:'yacs-'+sourceUrl.match(/store-(\d+)/)?.[1],name,chain_name:'ヤックスドラッグ',
      address:address.replace(/^〒\d+\s*/,''),lat:Number(lat),lng:Number(lng),hours:'',sourceUrl,collectedAt:page.collectedAt,coordinateEvidence:'Official retail search data-lat/data-lon'}))
    coverage.yacs={discovered:rows.length,accepted:rows.length,enumerationComplete:true,scope:'Official all_store=true retail category'}
  },
  mine:async()=>{
    const url='https://www.mineiyakuhin.co.jp/store/',page=await get(url)
    const blocks=page.html.split('<li class="p-store__storeItem">').slice(1)
    assert(blocks.length>0,'Empty Mine directory')
    let accepted=0,excluded=0
    for(const block of blocks){
      const link=block.match(/<a(?=[^>]*class="p-store__storeTel is-drug")[^>]*>([\s\S]*?)<\/a>/)?.[0]
      if(!link){excluded++;continue}
      const mapUrl=link.match(/href="([^"]+)/)?.[1],name=clean(block.match(/p-store__storeName">([\s\S]*?)<\/p>/)?.[1]),address=clean(block.match(/p-store__storeAddress">([\s\S]*?)<\/p>/)?.[1])
      const row={id:'mine-'+createHash('sha256').update(name+'|'+address).digest('hex').slice(0,16),name:`ミネドラッグ ${name}`,chain_name:'ミネドラッグ',address,hours:'',sourceUrl:url,mapUrl,collectedAt:page.collectedAt}
      const coordinates=mapUrl?.match(/!3d([\d.]+)!4d([\d.]+)/)
      if(!coordinates){pending.push({...row,reason:'No explicit place coordinates; viewport excluded'});continue}
      stores.push(validateStore({...row,lat:Number(coordinates[1]),lng:Number(coordinates[2]),coordinateEvidence:'Official Google Maps link place !3d/!4d coordinates'}));accepted++
    }
    coverage.mine={discovered:blocks.length,accepted,excluded,enumerationComplete:true}
  }
}
await Promise.allSettled(Object.entries(sources).map(async([source,run])=>{try{await run()}catch(e){failures.push({source,reason:e.message});coverage[source]={...coverage[source],enumerationComplete:false}}}))
assert.equal(new Set(stores.map(s=>s.id)).size,stores.length,'Duplicate official identities')
const report={generatedAt:new Date().toISOString(),coverage,accepted:stores.length,pending:pending.length,failures,applied:false}
for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
console.log(JSON.stringify(report))
if(failures.length)process.exitCode=1
