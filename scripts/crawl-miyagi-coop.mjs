import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'
import {textOf} from './crawl-membership-retail-b.mjs'
import {visibleHtml} from './crawl-membership-retail-a.mjs'

export function parseMiyagiCoopBranch(html,url,collectedAt) {
  html=visibleHtml(html)
  const branch=textOf(html.match(/<div class="pageTitle pageTitle2">[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1])
  const field=k=>textOf(html.match(new RegExp('<p class="detail-'+k+'2">([\\s\\S]*?)<\\/p>'))?.[1]).normalize('NFKC')
  const address=field('address'),phone=field('tel'),hours=field('time'),comment=field('comment')
  const code=new URL(url).searchParams.get('shop')
  assert(code&&/^\d+$/.test(code)&&branch&&address&&phone,'Missing official branch identity/address/phone')
  const drugServiceEvidence=[hours,comment].filter(s=>/直営薬店|コープドラッグ/.test(s)).join(' / ')
  if(!drugServiceEvidence)return null
  return {id:'miyagi-coop-otc-'+code,name:'みやぎ生協 '+branch,branchName:branch,chain_name:'みやぎ生協',
    address:address.startsWith('宮城県')?address:'宮城県'+address,pref:'宮城県',phone,
    sourceUrl:url,collectedAt,drugServiceEvidence,
    reason:/薬店[^。]*閉店|薬店[^。]*休業/.test(drugServiceEvidence)?'Medicine department closure/status review required':
      'Official direct medicine department; location and duplicate identity review required'}
}

async function main() {
  const out=process.argv.find(s=>s.startsWith('--out='))?.slice(6)||'artifacts/drugstores-miyagi-coop-refresh'
  const get=await createFetcher(out,false,process.argv.includes('--resume')),page=await get('https://www.miyagi.coop/shop/')
  const urls=[...new Set([...page.html.matchAll(/href="([^"]*store\.php\?shop=\d+)"/g)].map(m=>new URL(m[1],page.url).href))]
  assert(urls.length,'Empty official branch directory')
  assert(urls.every(u=>new URL(u).origin===new URL(page.url).origin),'Unexpected branch origin')
  const pending=[],excluded=[],failures=[]
  for(const url of urls) {
    try {
      const p=await get(url),row=parseMiyagiCoopBranch(p.html,url,p.collectedAt)
      if(row)pending.push(row)
      else excluded.push({sourceUrl:url,collectedAt:p.collectedAt,reason:'No explicit branch direct medicine department evidence'})
    }catch(error){failures.push({url,reason:error.message})}
    for(const [file,value]of Object.entries({'pending.json':pending,'excluded.json':excluded,'failures.json':failures}))
      await writeFile(out+'/'+file,JSON.stringify(value,null,2))
    console.log(JSON.stringify({processed:pending.length+excluded.length+failures.length,total:urls.length,drugDepartments:pending.length}))
  }
  await writeFile(out+'/report.json',JSON.stringify({generatedAt:new Date().toISOString(),source:page.url,
    selected:urls.length,drugDepartments:pending.length,excluded:excluded.length,failures:failures.length,
    enumerationComplete:failures.length===0,applied:false,nationalComplete:false},null,2))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
