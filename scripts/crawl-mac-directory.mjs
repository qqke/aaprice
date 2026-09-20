import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseCoordinateLabel} from './crawl-sugiyama.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'

const source='https://www.daiya-grp.co.jp/store/'
const clean=s=>(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
export function parseMac(html,collectedAt){
  return html.split('<div class="store-item">').slice(1).map(block=>{
    const name=clean(block.match(/<div class="store-title">([\s\S]*?)<\/div>/)?.[1])
    const address=clean(block.match(/<div class="store-address">([\s\S]*?)<\/div>/)?.[1]).replace(/^〒[\d-]+\s*/,'')
    assert(name&&address,'Missing Mac identity')
    const values=[...block.matchAll(/<span class="label">([^<]+)<\/span>\s*<span class="value">([\s\S]*?)<\/span>/g)].map(([,k,v])=>[k,clean(v)])
    const field=k=>values.find(([label])=>label===k)?.[1]||''
    const row={id:'mac-'+createHash('sha256').update(name+'|'+address).digest('hex').slice(0,16),name:name.startsWith('mac')?name:'mac '+name,
      chain_name:'ドラッグストアmac',address,phone:field('TEL'),hours:field('営業時間'),sourceUrl:source,collectedAt,taxFree:null}
    if(!/alt="医薬品、健康食品"/.test(block))return {pending:{...row,reason:'Retail classification needs review'}}
    if(/閉店|休業|予定/.test(name))return {pending:{...row,reason:'Closure/future notice'}}
    try{return {store:validateStore({...row,...parseCoordinateLabel(block)})}}
    catch(e){return {pending:{...row,reason:e.message}}}
  })
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-mac-2026-09-13'
  const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume')
  const get=await createFetcher(out,offline,resume),p=await get(source)
  let raw
  if(offline||resume){try{raw=await readFile(`${out}/search.json`,'utf8')}catch(e){if(offline)throw e}}
  if(!raw){
    const config=JSON.parse(p.html.match(/var store_ajax = (.*?);/)[1])
    assert.equal(config.ajax_url,'https://www.daiya-grp.co.jp/wp-admin/admin-ajax.php')
    const response=await fetch(config.ajax_url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({action:'store_search',nonce:config.nonce,province_id:'all',city_ids:'',store_cats:'',store_products:'',keyword:''}),signal:AbortSignal.timeout(25000)})
    assert(response.ok,`Search HTTP ${response.status}`);raw=await response.text()
    assert.equal(JSON.parse(raw).success,true);await writeFile(`${out}/search.json`,raw)
  }
  const result=JSON.parse(raw);assert.equal(result.success,true)
  const parsed=parseMac(result.data.html,p.collectedAt),stores=parsed.flatMap(x=>x.store?[x.store]:[]),pending=parsed.flatMap(x=>x.pending?[x.pending]:[])
  assert.equal(parsed.length,Number(result.data.count),'Incomplete Mac directory')
  assert.equal(new Set([...stores,...pending].map(x=>x.id)).size,parsed.length)
  const report={generatedAt:new Date().toISOString(),source,expected:Number(result.data.count),discovered:parsed.length,accepted:stores.length,pending:pending.length,enumerationComplete:true,applied:false}
  for(const [file,value] of Object.entries({'stores.json':stores,'pending.json':pending,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
