import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'

const source = 'https://www.kusurinosunroad.com/store.php'
const clean = s => (s || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
export function parseSunroad(html, collectedAt) {
  const section = html.replace(/<!--[\s\S]*?-->/g,'').match(/<h1 id="p2">ドラッグストア<\/h1>([\s\S]*?)<h1 id="p3">/)?.[1]
  assert(section, 'Missing official retail category')
  const blocks = [...section.matchAll(/<div class="twelfth_child">([\s\S]*?)(?=<div class="twelfth_child">|<h2>|$)/g)]
  assert(blocks.length>0,'Empty retail directory')
  return blocks.map(([,block])=>{
    const shortName=clean(block.match(/^([\s\S]*?)<\/div>/)?.[1])
    const field = key => clean(block.match(new RegExp(`<div class="${key}">([\\s\\S]*?)</div>`))?.[1])
    const address=field('fourteenth_child').replace(/^〒[\d-]+\s*/,'')
    const phone=field('thirteenth_child'),hours=field('fifteenth_child')
    assert(shortName && /^(山梨県|長野県)/.test(address) && phone && hours,'Incomplete retail row')
    return {id:`sunroad-${createHash('sha256').update(shortName+'|'+address).digest('hex').slice(0,16)}`,
      name:`クスリのサンロード ${shortName}`,chain_name:'クスリのサンロード',address,phone,hours,
      lat:null,lng:null,sourceUrl:source+'#p2',collectedAt,coordinateStatus:'missing',reason:'Official retail directory has no store coordinates'}
  })
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-sunroad-2026-09-13'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const page=await get(source), rows=parseSunroad(page.html,page.collectedAt)
  assert.equal(new Set(rows.map(s=>s.id)).size,rows.length,'Duplicate source identities')
  const report={source,collectedAt:page.collectedAt,discovered:rows.length,accepted:0,pending:rows.length,enumerationComplete:true,
    scope:'Only the twelfth_child retail rows in official drugstore section; pharmacy rows excluded',applied:false}
  for(const [file,data] of Object.entries({'pending.json':rows,'stores.json':[],'report.json':report})) await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
  console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
