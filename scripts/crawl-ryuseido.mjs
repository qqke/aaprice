import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseCoordinateLabel} from './crawl-sugiyama.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'

const base='https://www.ryuseido.co.jp/shop/',source=base+'index.html'
const clean=s=>(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
export function parseRyuseidoIndex(html,collectedAt){
  const rows=[];let pref=''
  for(const [,block] of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)){
    const heading=clean(block).match(/ー\s*(東京都|神奈川県|埼玉県)\s*[ー－]/)
    if(heading){pref=heading[1];continue}
    const link=block.match(/href="(\d+\.html)">([^<]+)<\/a>/)
    if(!link)continue
    const cells=[...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>clean(m[1]))
    assert(pref&&cells.length===3&&cells[1]&&cells[2],'Invalid official directory row')
    rows.push({id:`ryuseido-${link[1].split('.')[0]}`,name:`龍生堂 ${clean(link[2])}`,chain_name:'龍生堂',
      address:pref+cells[1],phone:cells[2],sourceUrl:new URL(link[1],base).href,sourceListUrl:source,
      addressEvidence:'Official directory prefecture heading and address',collectedAt})
  }
  assert(rows.length>0,'Empty official directory')
  assert.equal(new Set(rows.map(s=>s.id)).size,rows.length)
  return rows
}
export function parseRyuseidoDetails(html){
  const rows=new Map([...html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g)].map(([,k,v])=>[clean(k),clean(v)]))
  assert(rows.get('住所')&&rows.get('営業時間'),'Missing detail address/hours')
  return {hours:rows.get('営業時間'),detailAddress:rows.get('住所'),notes:rows.get('備考')||''}
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-ryuseido-2026-09-13'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const page=await get(source), candidates=parseRyuseidoIndex(page.html,page.collectedAt)
  const stores=[],pending=[],excluded=[],failures=[]
  for(const row of candidates){
    try{
      const detail=await get(row.sourceUrl),parsed={...row,...parseRyuseidoDetails(detail.html),collectedAt:detail.collectedAt}
      if(/調剤店/.test(row.name)){excluded.push({...parsed,reason:'Dispensing-only store'});continue}
      if(/COSMETICS/i.test(row.name)){pending.push({...parsed,reason:'Cosmetics specialist; retail drugstore classification unverified'});continue}
      if(/閉店|休業/.test(parsed.notes)){pending.push({...parsed,reason:'Closure notice requires review'});continue}
      try{stores.push(validateStore({...parsed,...parseCoordinateLabel(detail.html)}))}
      catch(e){pending.push({...parsed,lat:null,lng:null,reason:e.message})}
    }catch(e){failures.push({...row,reason:e.message})}
  }
  const report={generatedAt:new Date().toISOString(),source,listCollectedAt:page.collectedAt,discovered:candidates.length,
    accepted:stores.length,pending:pending.length,excluded:excluded.length,failures,enumerationComplete:failures.length===0,applied:false}
  for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores))
  console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
