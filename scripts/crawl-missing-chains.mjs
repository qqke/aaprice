import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {buildImportSql} from './crawl-drugstores.mjs'
import {verifyMarkerAddress} from './official-embed-marker.mjs'

const clean=s=>(s||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const active=s=>s.replace(/<!--[\s\S]*?-->/g,'')
const field=(s,k)=>clean(s.match(new RegExp(`<th[^>]*>\\s*${k}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`))?.[1])
export function parseKomeyaName(html){
  const name=clean(html.match(/property="og:title" content="([^"]+)/)?.[1]).replace(/ - 株式会社コメヤ薬局$/,'')
  assert(name&&name!=='株式会社コメヤ薬局','Missing official store name')
  return name
}
export function parseEmbeddedMarker(html,mapUrl){
  const feature=decodeURIComponent(mapUrl).match(/!1s(0x[\da-f]+:0x[\da-f]+)/)?.[1]
  assert(feature,'Official embed does not identify a place feature')
  // Coordinates must belong to the exact place selected by the official embed; viewport arrays are ignored.
  const marks=[...html.matchAll(/\[\["(0x[\da-f]+:0x[\da-f]+)",("(?:[^"\\]|\\.)*"),\[([\d.]+),([\d.]+)\]/g)].filter(m=>m[1]===feature)
  assert.equal(marks.length,1,'Missing or ambiguous matching place marker')
  const m=marks[0]
  return {lat:Number(m[3]),lng:Number(m[4]),mapFeature:feature,markerAddress:JSON.parse(m[2]),coordinateEvidence:'Exact official embedded-map place feature marker (not viewport)',coordinateSourceUrl:mapUrl}
}
export function parseHashi(html,url,collectedAt){
  html=active(html)
  assert(/<p>ドラッグストア<\/p>/.test(html)&&/化粧品/.test(field(html,'取り扱い商品')),'Not classified as retail drugstore')
  return {id:'hashi-'+new URL(url).pathname.split('/').filter(Boolean).at(-1),chain_name:'ハシドラッグ',name:clean(html.match(/<p class="topborder_ttl">(ハシドラッグ[\s\S]*?)<\/p>/)?.[1]),address:field(html,'所在地').replace(/^〒[\d-]+\s*/,''),hours:field(html,'営業時間／定休日'),phone:field(html,'お問い合わせ').replace(/^TEL[：:]\s*/,''),taxFree:null,sourceUrl:url,collectedAt,retailEvidence:'Official store page explicitly ドラッグストア and cosmetics retail'}
}
export function parseCares(html,collectedAt){
  return [...active(html).matchAll(/<li class="shadow pd40 store mb60">([\s\S]*?)<\/li>/g)].map(([,s],i)=>{
    const name=clean(s.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1])
    const address=clean(s.match(/<dt[^>]*>所在地<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/)?.[1]).replace(/^〒[\d-]+\s*/,'')
    const pref=/木津川市|長岡京市/.test(address)?'京都府':'大阪府'
    return {id:'cares-'+createHash('sha256').update(name+address).digest('hex').slice(0,16),chain_name:'ケアーズドラッグ',name:name.split(/\(OTC\)|\/|／/)[0],address:pref+address,addressEvidence:'Official directory Osaka city / Kyoto regional headings',phone:s.match(/href="tel:([^"]+)/)?.[1]||'',hours:field(s,'営業時間'),sourceUrl:'https://caresdrug.com/store.html#s'+(/木津川市/.test(address)?'05':/摂津市/.test(address)?'03':/寝屋川市/.test(address)?'04':'01'),taxFree:null,collectedAt,retail:/ケアーズドラッグ/.test(name),retailEvidence:'Official directory names ケアーズドラッグ OTC retail',html:s}
  })
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-missing-chains-2026-10-03'
  const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
  const stores=[],pending=[],excluded=[],sources=[]
  async function accept(row,html){
    const mapUrl=active(html).match(/<iframe[^>]*src="(https:\/\/www\.google\.com\/maps\/embed\?[^"<>]+)/)?.[1]?.replace(/\s/g,'')
    assert(mapUrl,'No official embedded place map')
    const map=await get(mapUrl),marker=parseEmbeddedMarker(map.html,mapUrl)
    if(!/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(row.address)){
      assert(marker.markerAddress.includes('石川県'),'Prefecture missing in official address and matching marker')
      row.address='石川県'+row.address;row.addressEvidence='Official street address plus prefecture from its exact embedded place marker'
    }
    if(row.id.startsWith('komeya-'))verifyMarkerAddress({coordinateEntityAddress:marker.markerAddress},row)
    assert(!/閉店|休業中|オープン予定/.test(row.name),'Store closure/opening needs review')
    stores.push(validateStore({...row,...marker}))
  }
  async function chain(source,fn){const before={accepted:stores.length,pending:pending.length,excluded:excluded.length};const report={source,enumerationComplete:false};try{await fn(report)}catch(e){report.failure=e.message;pending.push({source,reason:e.message})}Object.assign(report,{accepted:stores.length-before.accepted,pending:pending.length-before.pending,excluded:excluded.length-before.excluded});sources.push(report)}
  await chain('hashi',async r=>{
    const url='https://www.hashi-drug.co.jp/store',list=await get(url),urls=[...new Set([...list.html.matchAll(/href="(https:\/\/www\.hashi-drug\.co\.jp\/store\/[^"/]+\/)"/g)].map(m=>m[1]))]
    assert(urls.length>0,'Empty Hashi directory');r.discovered=urls.length;r.sourceUrl=url
    for(const url of urls){let row={sourceUrl:url};try{const p=await get(url);row={...parseHashi(p.html,url,p.collectedAt),sourceListUrl:r.sourceUrl};await accept(row,p.html)}catch(e){pending.push({...row,reason:e.message})}}
    r.enumerationComplete=true
  })
  await chain('cares',async r=>{
    const url='https://caresdrug.com/store.html',p=await get(url),rows=parseCares(p.html,p.collectedAt);assert(rows.length>0,'Empty Cares directory');r.discovered=rows.length;r.sourceUrl=url
    for(const {html,retail,...row} of rows){if(!retail){excluded.push({...row,reason:'Official pharmacy-only name; OTC drugstore not present'});continue}try{await accept(row,html)}catch(e){pending.push({...row,reason:e.message})}}
    r.enumerationComplete=true
  })
  await chain('komeya',async r=>{
    const url='https://komeya-drug.com/store/',p=await get(url),company=await get('https://komeya-drug.com/company/'),retailSection=company.html.match(/【調剤・ドラッグ併設店】([\s\S]*?)【調剤専門店】/)?.[1];assert(retailSection,'Missing official retail classification');r.classificationSourceUrl=company.url;r.sourceUrl=url
    const urls=[...new Set([...p.html.matchAll(/href="(https:\/\/komeya-drug\.com\/store\/[^"/]+\/)"/g)].map(m=>m[1]))].filter(u=>!u.endsWith('/feed/'));r.discovered=urls.length
    for(const url of urls){let row={sourceUrl:url};try{
      const d=await get(url),h=active(d.html),name=parseKomeyaName(h)
      const key=name.split(/[＋+]/)[0].replace(/^ドラッグストア/,'')
      const retail=clean(retailSection).replace(/\(本店\)/g,'本店').includes(key)
      row={id:'komeya-'+h.match(/postid-(\d+)/)?.[1],chain_name:'コメヤ薬局',name,sourceUrl:url,sourceListUrl:r.sourceUrl,collectedAt:d.collectedAt,taxFree:null,retailEvidence:'Official company retail/mini-drugstore category',classificationSourceUrl:company.url}
      if(!retail){excluded.push({...row,reason:'Not present in official retail drugstore categories'});continue}
      const side=h.match(/<div id="side">([\s\S]*?)<\/div>/)?.[1]||'',spans=[...side.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m=>clean(m[1]))
      row.address=spans[1];row.phone=clean(side).match(/(?:TEL|電話)[：:]?\s*(?:電話)?\s*([\d-]{10,13})/)?.[1]||'';row.hours=clean(side).match(/営業時間[：:]\s*(.*?)(?:定休日|$)/)?.[1]||''
      await accept(row,h)
    }catch(e){pending.push({...row,reason:e.message})}}
    r.enumerationComplete=true
  })
  await chain('asahi',async r=>{
    const url='https://drug-asahi.co.jp/ten.html',p=await get(url);r.sourceUrl=url
    const rows=[...active(p.html).matchAll(/<tr id="(\d+)">([\s\S]*?)(?=<tr|<\/table>)/g)];r.discovered=rows.length;assert(rows.length>0,'Empty Asahi directory')
    for(const [,id,h] of rows){const cells=[...h.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>clean(m[1])),idx=cells.findIndex(x=>x.startsWith('〒')),name=cells[idx-1],address=cells[idx]?.replace(/^〒[\d-]+\s*/,'').split('営業時間')[0].trim();const row={id:'asahi-'+id,name:'スーパードラッグアサヒ '+name,chain_name:'スーパードラッグアサヒ',address,phone:cells[idx+1]?.replace(/^TEL\s*/,''),hours:cells[idx]?.split('営業時間')[1]?.trim(),sourceUrl:url+'#'+id,collectedAt:p.collectedAt};pending.push({...row,reason:/スーパーシティ|Express/.test(name)?'Non-standard supermarket/convenience format requires retail classification review':'Official map is static image; no reliable place-marker coordinates'})}
    r.enumerationComplete=true
  })
  await chain('koei',async r=>{r.sourceUrl='https://www.drugkoei.com/';await get(r.sourceUrl);throw Error('Directory parser not verified')})
  assert.equal(new Set(stores.map(x=>x.id)).size,stores.length)
  const report={generatedAt:new Date().toISOString(),sources,accepted:stores.length,pending:pending.length,excluded:excluded.length,applied:false}
  for(const [file,value]of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(value,null,2))
  await writeFile(`${out}/import.sql`,buildImportSql([],stores));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
