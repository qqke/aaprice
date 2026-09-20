import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'

const base='https://www.genky.co.jp/sp/stores/'
const clean=s=>(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
export function parseGenkyIdentity(html,sourceUrl,collectedAt){
  const name=html.match(/new google\.maps\.Marker\(\{position:\s*myLatlng,map:\s*map,title:"([^"]+)"/)?.[1]
  const field=key=>clean(html.match(new RegExp(`<h2>${key}</h2>\\s*<p[^>]*>([\\s\\S]*?)</p>`))?.[1])
  return {id:`genky-${new URL(sourceUrl).searchParams.get('cont_no')}`,name,chain_name:'ゲンキー',
    address:field('所在地').replace(/^〒[\d-]+\s*/,''),phone:field('TEL'),hours:field('営業時間'),taxFree:null,sourceUrl,collectedAt}
}
export function parseGenkyDetail(html,sourceUrl,collectedAt){
  html=html.replace(/<!--[\s\S]*?-->/g,'')
  const coord=html.match(/var myLatlng\s*=\s*new google\.maps\.LatLng\(\s*([\d.]+),\s*([\d.]+)\)/)
  assert(coord && /new google\.maps\.Marker\(\{position:\s*myLatlng/.test(html),'No explicit store marker coordinates')
  const row=parseGenkyIdentity(html,sourceUrl,collectedAt)
  assert(row.name&&!/閉店|休業|予定|近日/.test(row.name),'Missing name or closure/future notice')
  assert(row.hours,'Missing opening hours')
  return validateStore({...row,lat:Number(coord[1]),lng:Number(coord[2]),coordinateEvidence:'Official Google Maps Marker position myLatlng'})
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-genky-complete-2026-09-13'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const first=await get(base+'list.php?g=1&page=0')
  const groups=[...new Set([...first.html.matchAll(/<option value="list\.php\?g=(\d+)"/g)].map(m=>m[1]))]
  assert(groups.length>0,'No official prefecture filters')
  const links=new Map(),coverage=[]
  for(const g of groups){
    let url=base+`list.php?g=${g}&page=0`,expected;const seen=new Set(),groupIds=new Set()
    while(url){
      assert(!seen.has(url)&&seen.size<100,'Pagination loop');seen.add(url)
      const page=await get(url),total=Number(page.html.match(/該当店舗\s*(\d+)件/)?.[1]);assert(total>0,'Missing official regional total')
      expected??=total;assert.equal(total,expected,'Directory changed during crawl')
      for(const [,href] of page.html.matchAll(/href="(cont\.php\?cont_no=\d+[^"<>]*)"/g)){
        const full=new URL(href.replaceAll('&amp;','&'),base),id=full.searchParams.get('cont_no');groupIds.add(id)
        links.set(id,full.href)
      }
      const next=page.html.match(/href="(list\.php\?[^"<>]+)">次の20件/)?.[1]
      url=next?new URL(next.replaceAll('&amp;','&'),base).href:null
    }
    assert.equal(groupIds.size,expected,'Incomplete regional directory')
    coverage.push({group:g,expected,discovered:groupIds.size,pages:seen.size})
    console.log(`Genky region ${g}: ${groupIds.size}/${expected}`)
  }
  await writeFile(`${out}/discovery.json`,JSON.stringify({coverage,urls:[...links.values()]},null,2))
  const stores=[],pending=[],failures=[]
  async function save(complete){
    const report={generatedAt:new Date().toISOString(),source:base,coverage,discovered:links.size,accepted:stores.length,pending:pending.length,failures,enumerationComplete:complete&&failures.length===0,applied:false}
    for(const [file,value] of Object.entries({'stores.json':stores,'pending.json':pending,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
    await writeFile(`${out}/import.sql`,buildImportSql([],stores))
  }
  for(const url of links.values()){
    try{
      let page
      for(let attempt=0;attempt<3;attempt++){try{page=await get(url);break}catch(e){if(attempt===2||process.argv.includes('--offline'))throw e}}
      try{stores.push(parseGenkyDetail(page.html,url,page.collectedAt))}
      catch(e){pending.push({...parseGenkyIdentity(page.html,url,page.collectedAt),lat:null,lng:null,reason:e.message})}
    }
    catch(e){failures.push({url,reason:e.message})}
    const done=stores.length+pending.length+failures.length
    if(done%25===0){await save(false);console.log(`Genky details ${done}/${links.size}: ${stores.length} accepted, ${pending.length} pending, ${failures.length} failed`)}
  }
  assert.equal(new Set(stores.map(s=>s.id)).size,stores.length)
  await save(true);console.log(JSON.stringify({out,discovered:links.size,accepted:stores.length,pending:pending.length,failures:failures.length}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
