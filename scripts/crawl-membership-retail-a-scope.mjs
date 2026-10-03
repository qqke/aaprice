import {readFile,writeFile} from 'node:fs/promises'
import {visibleHtml} from './crawl-membership-retail-a.mjs'
const out='artifacts/drugstores-membership-retail-a-2026-10-03'
const text=h=>visibleHtml(h).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().normalize('NFKC')
const page=JSON.parse(await readFile(out+'/cache/kiyama.json','utf8')),links=new Map()
for(const m of visibleHtml(page.html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)){
 const url=new URL(m[1],page.url).href,name=text(m[2])
 if(/^https:\/\/www\.kiyama-drug.com\/shopdate\/[^/?#]+\/$/.test(url)&&name&&!/エリア/.test(name))links.set(url,name)
}
const ledger=[]
for(let i=0,entries=[...links];i<entries.length;i+=4)await Promise.all(entries.slice(i,i+4).map(async([url,name])=>{
 const id=url.split('/').filter(Boolean).at(-1),file=out+'/cache/kiyama-'+id+'.json';let p
 try{p=JSON.parse(await readFile(file,'utf8'))}catch{try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});p={url,status:r.status,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(p))}catch(e){p={url,status:0,error:e.message}}}
 const t=text(p.html||''),otcPhone=t.match(/\(OTC\)\s*(0[\d-]+)/)?.[1]
 ledger.push({id:'kiyama-'+id,name,chain_name:'木山薬局グループ',sourceUrl:url,collectedAt:p.collectedAt,status:/休業/.test(name)?'temporarily-closed':otcPhone?'explicit-OTC-retail':'retail-scope-pending',phone:otcPhone||t.match(/電話番号\s*(?:\(調剤\)\s*)?(0[\d-]+)/)?.[1]||null,address:t.match(/所在地\s*〒\s*\d{3}-?\d{4}\s*(.*?)\s*地図/)?.[1]?.trim()||null,retailTerms:t.match(/.{0,35}(?:一般用医薬品|一般医薬品|OTC|化粧品|医薬品販売).{0,45}/g)||[],reason:otcPhone?'Official exact branch OTC hours and phone':'Dispensing branch directory alone does not establish drugstore retail scope',sourceStatus:p.status})
}))
await writeFile(out+'/kiyama-scope-ledger.json',JSON.stringify(ledger,null,2));console.log(JSON.stringify({branches:ledger.length,withRetailTerms:ledger.filter(x=>x.retailTerms.length).length,fetchFailed:ledger.filter(x=>x.sourceStatus!==200).length}))
