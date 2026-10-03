import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createFetcher} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-additional-chains-2026-10-03',get=await createFetcher(out,false,true)
const plain=s=>String(s||'').replace(/<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/g,'').replace(/<[^>]*>/g,' ').replace(/&minus;/g,'−').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
const field=(h,label)=>plain(h.match(new RegExp(`<dt>\\s*${label}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`))?.[1])
const candidates=[],sources=[]
for(const [brand,url] of Object.entries({shimokawa:'https://www.shimokawa-ph.co.jp/archives/store',yoneki:'https://www.yoneki-jujido.co.jp/store'})){
 try{const page=await get(url),rows=[]
  if(brand==='shimokawa')for(const block of page.html.split(/<div class="store_wrap[^>]*>/).slice(1)){
   const branch=plain(block.match(/<h3>([\s\S]*?)<\/h3>/)?.[1]);if(!branch)continue
   rows.push({name:'シモカワ '+branch,chain_name:'シモカワ',address:field(block,'住所').replace(/^〒\d{3}-\d{4}\s*/,''),phone:field(block,'TEL').match(/\d{2,4}-\d{2,4}-\d{4}/)?.[0]||'',hours:field(block,'営業時間'),sourceUrl:url,collectedAt:page.collectedAt})
  }
  if(brand==='yoneki'){
   const text=plain(page.html),section=text.slice(text.indexOf('ドラッグストア ヨネキ十字堂 前田店'),text.indexOf('お問い合わせ ご質問'))
   assert(section,'Retail section missing')
   for(const m of section.matchAll(/(ヨネキ十字堂|ヨネキドラッグ)\s+([^〒]+)〒\d{3}-\d{4}\s+(.*?)\s*Tel:(\d{2,4}-\d{2,4}-\d{4})([\s\S]*?)(?=ヨネキ(?:十字堂|ドラッグ)|$)/g))rows.push({name:`${m[1]} ${m[2].trim()}`,chain_name:'ヨネキ十字堂',address:m[3].trim(),phone:m[4],hours:m[5].replace('＜営業時間＞','').trim(),sourceUrl:url,collectedAt:page.collectedAt})
   assert.equal(rows.length,3,'Unexpected retail branch enumeration')
  }
  assert(rows.length>0,'No retail branches enumerated')
  for(const row of rows)candidates.push({...row,id:`${brand}-${createHash('sha256').update(row.name).digest('hex').slice(0,16)}`,reason:'Official retail directory enumerated; precise business marker verification pending'})
  sources.push({brand,url,discovered:rows.length,accepted:0,pending:rows.length,enumerationComplete:true})
 }catch(e){sources.push({brand,url,error:e.message,enumerationComplete:false})}
}
const pending=JSON.parse(await readFile(`${out}/pending.json`,'utf8')),stores=JSON.parse(await readFile(`${out}/stores.json`,'utf8')),seen=new Set([...pending,...stores].map(x=>x.id))
pending.push(...candidates.filter(x=>!seen.has(x.id)))
await writeFile(`${out}/regional-candidates.json`,JSON.stringify(candidates,null,2))
await writeFile(`${out}/pending.json`,JSON.stringify(pending,null,2))
const report=JSON.parse(await readFile(`${out}/report.json`,'utf8'));report.sources=report.sources.filter(x=>!sources.some(s=>s.brand===x.brand));report.sources.push(...sources);report.pending=pending.length
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(sources))
