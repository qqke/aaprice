import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {databaseProcess} from './sync-sundrug.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {indexExistingBranches,possibleExistingBranches,normalizeIdentityText} from './drugstore-identity.mjs'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-membership-retail-a-2026-10-03'
export const visibleHtml=html=>html.replace(/<!--[\s\S]*?-->/g,'')
const text=html=>visibleHtml(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().normalize('NFKC')
export function parseKoei(html,sourceUrl){
 return visibleHtml(html).split(/<div id="storeblock">/).slice(1).map(block=>{
  const rawName=text(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]||'').replace(/ドラッグストア$/,'').trim(),name='ドラッグコーエイ '+rawName,url=block.match(/<a\s+href="([^"]+)"/)?.[1]
  const values=[...block.matchAll(/<li><div class="item">([\s\S]*?)<\/div><div>([\s\S]*?)<\/div><\/li>/g)],fields=Object.fromEntries(values.map(x=>[text(x[1]).replaceAll(' ',''),text(x[2])]))
  const reason=/閉店/.test(text(block))?'official-permanent-closure':/調剤薬局/.test(rawName)?'dispensing-department-excluded':null
  let address=fields['住所']||'';if(address&&!address.startsWith('福岡県'))address='福岡県'+address
  return {id:'koei-'+(url?.split('/').filter(Boolean).at(-1)||createHash('sha256').update(rawName).digest('hex').slice(0,10)),name,chain_name:'ドラッグコーエイ',address,phone:(fields['電話番号']||'').replace(/^TEL[：:]\s*/,''),hours:fields['営業時間']||'',sourceUrl:url||sourceUrl,sourceDirectoryUrl:sourceUrl,sourceAddressRaw:fields['住所']||'',retailEvidence:'Current official drugstore directory with medicines/cosmetics/daily goods',reason}
 })
}
export function parseAobado(html,sourceUrl){
 return [...visibleHtml(html).matchAll(/<li>\s*<div class="box">([\s\S]*?)<\/li>/g)].map(m=>{
  const block=m[1],name=text(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]||''),url=block.match(/<a class="btn01" href="([^"]+)"/)?.[1],raw=text(block.match(/<div class="address">([\s\S]*?)<\/div>/)?.[1]||'').replace(/^〒\d{3}-\d{4}\s*/,'');let address=raw
  if(!/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(raw))address=(/okayama/.test(sourceUrl)?'岡山県':/yamaguchi/.test(sourceUrl)?'山口県':/久御山|八幡/.test(raw)?'京都府':'大阪府')+raw
  const active=/class="status-icon on"[^>]*>\s*<img[^>]+alt="要指導医薬品販売"/.test(block)
  return {id:'aobado-'+url?.split('/').filter(Boolean).at(-1),name,chain_name:'青葉堂グループ',address,phone:text(block.match(/<div class="tel">([\s\S]*?)<\/div>/)?.[1]||'').replace(/^TEL\s*/,''),sourceUrl:url||sourceUrl,sourceDirectoryUrl:sourceUrl,retailEvidence:active?'This exact official branch has active on icon for 要指導医薬品販売':'OTC retail not established for this branch',reason:!active?'branch-OTC-scope-review':null}
 }).filter(s=>s.name)
}
export function parseKashiwaba(html,sourceUrl){
 return visibleHtml(html).split(/<h3[^>]*>/).slice(1).map((block,i)=>{
  const branch=text(block.split('</h3>')[0]),fields=Object.fromEntries([...block.matchAll(/<tr>\s*<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g)].map(m=>[text(m[1]),text(m[2])]))
  const raw=(fields['所在地']||'').replace(/^〒\d{3}-\d{4}\s*/,'').replace(/地図はこちら≫.*$/,'').trim()
  return {id:'kashiwaba-'+String(fields['電話']||i).replaceAll('-',''),name:'カシワバ薬局 '+branch,chain_name:'カシワバ薬局',address:raw?'神奈川県'+raw:'',phone:fields['電話']||'',hours:fields['営業時間']||'',sourceUrl,retailEvidence:'Current ordinary branch directory; company explicitly sells OTC medicines/cosmetics/general goods and separately labels dispensing-only branch',scopeEvidenceUrl:'http://www.kashiwaba-ph.com/100.html',reason:/調剤専門/.test(branch)?'dispensing-only-excluded':branch==='本部'?'head-office-excluded':null}
 }).filter(x=>x.address)
}
export function parseAxis(html,url){
 const h=visibleHtml(html),t=text(h),name=text(h.match(/<title>([\s\S]*?)<\/title>/)?.[1]||'').split('|')[0].trim(),address=t.match(/〒\d{3}-\d{4}\s*(島根県.*?)\s+(?:月|\d{1,2}:)/)?.[1],phone=t.match(/TEL\s*[:：]\s*(0[\d-]+)/)?.[1],hours=t.match(/(?:島根県.*?)\s+((?:月|\d{1,2}:).*?)\s+TEL/)?.[1]
 if(!address||!phone||!t.includes('ドラックストア'))throw Error('Missing explicit official drugstore identity')
 return {id:'axis-'+url.split('/').filter(Boolean).at(-1),name,chain_name:'ウエーブ',address,phone,hours,sourceUrl:url,retailEvidence:'Official exact branch classified as ドラックストア and described medicine/cosmetics/goods retail'}
}
export function parseOhtemachi(html,sourceUrl){
 const t=text(html),rows=[]
 for(const m of t.matchAll(/(メディカル[^ ]+|大手町薬局椿高下店) 所在地 〒[\d-]+ (岡山県.*?) TEL ([\d-]+) FAX [\d-]+([\s\S]*?)(?=アクセス)/g)){
  const retail=/調剤併設型.?漢方相談薬局/.test(m[4])
  rows.push({id:'ohtemachi-'+m[3].replaceAll('-',''),name:m[1],chain_name:'大手町薬局',address:m[2],phone:m[3],sourceUrl,retailEvidence:retail?'This exact branch is an official 調剤併設型漢方相談薬局':'Branch OTC scope requires evidence',reason:'branch-OTC-scope-review'})
 }
 return rows
}
async function main(){
 await mkdir(out+'/cache',{recursive:true});const ledger=[]
 async function cache(id){return JSON.parse(await readFile(out+'/cache/'+id+'.json','utf8'))}
 for(const[id,parser]of [['koeistores',parseKoei],['kashiwaba',parseKashiwaba],['aobadokansai',parseAobado],['aobadookayama',parseAobado],['aobadoyamaguchi',parseAobado]]){const p=await cache(id);if(p.status!==200)throw Error('Official directory not available '+id);ledger.push(...parser(p.html,p.url).map(s=>({...s,collectedAt:p.collectedAt})))}
 for(const id of ['axis_iwami','axis_city','axis_yume']){const p=await cache(id);ledger.push({...parseAxis(p.html,p.url),collectedAt:p.collectedAt})}
 const ohtemachi=await cache('ohtemachi');ledger.push(...parseOhtemachi(ohtemachi.html,ohtemachi.url).map(s=>({...s,collectedAt:ohtemachi.collectedAt})))
 const hokubu=await cache('kiyama-hokubu');ledger.push({id:'kiyama-hokubu',name:'木山薬局北部店',chain_name:'木山薬局グループ',address:'熊本県天草市八幡町1-1',phone:'0969-24-2366',hours:'月～金 9:00～18:00、土 9:00～13:00、日曜・祝日・年末年始休',sourceUrl:hokubu.url,collectedAt:hokubu.collectedAt,retailEvidence:'Exact official branch separately publishes OTC hours and OTC phone'})
 const primary=[['honten','佐々木薬局','京都府舞鶴市大字溝尻150-35','0773-63-5445','https://kouseikyoku.mhlw.go.jp/kinki/2025.7_kikanzentai_kyoto_yakkyoku.pdf'],['mori','佐々木薬局 森店','京都府舞鶴市倉梯町30-2','0773-64-2660','https://kouseikyoku.mhlw.go.jp/kinki/2025.7_kikanzentai_kyoto_yakkyoku.pdf'],['nishi','ドラッグささき西舞鶴店','京都府舞鶴市伊佐津200-17','0773-78-3888','https://www.nippo-yakuhin.jp/shops/40219.html'],['takahama','佐々木薬局 高浜店','福井県大飯郡高浜町宮崎77-7-1','0770-72-4488','https://www.iryou.teikyouseido.mhlw.go.jp/znk-web/juminkanja/S2430/initialize?kikanCd=7189002270&kikanKbn=5&prefCd=18']]
 for(const[id,name,address,phone,sourceUrl]of primary)ledger.push({id:'sasaki-'+id,name,chain_name:'佐々木薬局',address,phone,sourceUrl,sourceDirectoryUrl:'https://www.uchiyama-sasaki.com/',retailEvidence:'Official company names this exact physical branch and confirms medicines/cosmetics/baby/care/general merchandise retail; branch identity supplemented by government or manufacturer directory'})
 const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from(select id,name,chain_name,address,pref,lat,lng from stores)s;"),db=JSON.parse(raw.slice(raw.indexOf('['))),index=indexExistingBranches(db),stores=[],pending=[],excluded=[]
 const near=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lng-b.lng)*111320*Math.cos(a.lat*Math.PI/180))<60
 for(let i=0;i<ledger.length;i+=4)await Promise.all(ledger.slice(i,i+4).map(async row=>{
  row.pref=row.address.match(/^(東京都|北海道|大阪府|京都府|.{2,3}県)/)?.[1]||''
  if(row.reason){if(row.reason==='branch-OTC-scope-review'){row.status='pending-scope';pending.push(row)}else excluded.push(row);return}
  row.matchedIds=[...new Set([...db.filter(d=>d.id===row.id).map(d=>d.id),...possibleExistingBranches(row,index),...db.filter(d=>normalizeAddress(d.address)===normalizeAddress(row.address)||(d.pref===row.pref&&normalizeIdentityText(d.name)===normalizeIdentityText(row.name))).map(d=>d.id)])]
  if(row.matchedIds.length){row.status='existing-or-identity-review';return}
  try{const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',file=out+'/cache/marker-'+createHash('sha256').update(url).digest('hex')+'.json';let p;try{p=JSON.parse(await readFile(file,'utf8'))}catch{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Marker HTTP '+r.status);p={url,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(p))}
   const marker=parseOfficialEmbedMarker(p.html,{...row,name:row.name.replaceAll('・','').replace(/[（(][^）)]*[）)]/g,'').replaceAll('⻄','西')});verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)});const nearby=db.filter(s=>near(marker,s));if(nearby.length)throw Error('Nearby existing identity review: '+nearby.map(s=>s.id).join(','));if(stores.some(s=>near(marker,s)))throw Error('Nearby staged identity review');row.status='accepted';stores.push(validateStore({...row,...marker,coordinateSourceUrl:url,coordinateCollectedAt:p.collectedAt}))
  }catch(e){row.status='pending-marker';pending.push({...row,reason:e.message.split('\n')[0]})}
 }))
 for(const[key,value]of Object.entries({stores,pending,excluded,'license-ledger':ledger}))await writeFile(out+'/'+key+'.json',JSON.stringify(value,null,2))
 const report={generatedAt:new Date().toISOString(),databaseRows:db.length,enumeratedBranches:ledger.length,accepted:stores.length,pending:pending.length,existingOrIdentityReview:ledger.filter(s=>s.status==='existing-or-identity-review').length,excluded:excluded.length,byBrand:Object.fromEntries([...new Set(ledger.map(s=>s.chain_name))].map(brand=>[brand,{enumerated:ledger.filter(s=>s.chain_name===brand).length,accepted:stores.filter(s=>s.chain_name===brand).length,pending:pending.filter(s=>s.chain_name===brand).length,excluded:excluded.filter(s=>s.chain_name===brand).length,existing:ledger.filter(s=>s.chain_name===brand&&s.status==='existing-or-identity-review').length}])),nationalComplete:false,limitations:['Kiyama dispensing pharmacy network requires separate retail scope evidence','Ohtemachi company retail business cannot by itself establish all 11 individual branches retail','Some source street typos and building mismatches deliberately held']};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
