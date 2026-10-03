import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
export const out='artifacts/drugstores-license-west-2026-10-03'
const prefectures=['大阪府','兵庫県','京都府','奈良県','和歌山県','滋賀県','岡山県','広島県','山口県','鳥取県','島根県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']
export async function collect(){
 await mkdir(out+'/sources',{recursive:true})
 const catalogue=JSON.parse(await readFile('artifacts/drugstores-license-catalogue-2026-10-03/cache/package-search.json','utf8')).data.result.results
 const names=['252018_p_9627_1465266274677','431001_seisaku35-4','401005_tenpohanbaigyo','430005_00426']
 const sources=names.map(name=>{const d=catalogue.find(d=>d.name===name);const r=[...d.resources].sort((a,b)=>(b.last_modified||'').localeCompare(a.last_modified||''))[0];return {id:name,publisher:d.organization.title,title:d.title,notes:d.notes,resourceName:r.name,url:r.url,metadataModified:r.last_modified,scope:d.notes,catalogueUrl:'https://data.bodik.jp/dataset/'+d.id}})
 sources.push({id:'otsu-current-retail',publisher:'大津市',title:'店舗販売業一覧',url:'https://www.city.otsu.lg.jp/material/files/group/2/260601tenpo.xlsx',catalogueUrl:'https://www.city.otsu.lg.jp/soshiki/021/1440/od/1465266274677.html',asOf:'2026-06-01',pageUpdated:'2026-06-03',scope:'大津市のみ',caveat:'Official city current XLSX supersedes stale BODIK XLS resource'})
 sources.push({id:'shiga-retail',publisher:'滋賀県',title:'店舗販売業一覧',url:'https://www.pref.shiga.lg.jp/documents/4319/5612274.xlsx',catalogueUrl:'https://www.pref.shiga.lg.jp/eh00/4319.html',asOf:'2026-04-30',scope:'滋賀県内、大津市を除く',pageUpdated:'2026-05-21'})
 sources.push({id:'kyoto-city-retail',publisher:'京都市',title:'店舗販売業一覧',url:'https://www.city.kyoto.lg.jp/hokenfukushi/cmsfiles/contents/0000253/253035/080701tenpo.pdf',catalogueUrl:'https://www.city.kyoto.lg.jp/hokenfukushi/page/0000253035.html',asOf:'2026-07-01',scope:'京都市のみ',pageUpdated:'2026-07-08',caveat:'June 30 cessation filing lag; not Kyoto prefecture remainder'})
 for(const s of sources){
  const ext=new URL(s.url).pathname.split('.').at(-1);s.localFile=out+'/sources/'+s.id+'.'+ext
  try{const r=await fetch(s.url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer());await writeFile(s.localFile,bytes);s.bytes=bytes.length;s.download='ok'}catch(e){s.download='failed';s.error=e.message}
  console.log(s.id,s.download,s.bytes||s.error)
  await writeFile(out+'/source-index.json',JSON.stringify(sources,null,2))
 }
 const scopes=prefectures.map(prefecture=>({prefecture,state:'unresolved',complete:false,reason:'Full current retail-permit registry and all separately licensed municipality scopes not closed'}))
 scopes.find(s=>s.prefecture==='滋賀県').sources=['shiga-retail','252018_p_9627_1465266274677']
 scopes.find(s=>s.prefecture==='滋賀県').state='two-jurisdiction-sources-found-date-conflict-open'
 scopes.find(s=>s.prefecture==='熊本県').sources=['430005_00426','431001_seisaku35-4']
 scopes.find(s=>s.prefecture==='熊本県').state='two-jurisdiction-sources-found-reconciliation-open'
 scopes.find(s=>s.prefecture==='京都府').sources=['kyoto-city-retail']
 scopes.find(s=>s.prefecture==='福岡県').sources=['401005_tenpohanbaigyo']
 await writeFile(out+'/jurisdictions.json',JSON.stringify(scopes,null,2))
 await writeFile(out+'/report.json',JSON.stringify({collectedAt:new Date().toISOString(),prefectures:23,closedPrefectures:0,sources:sources.length,downloaded:sources.filter(s=>s.download==='ok').length,pending:'Parse, DB compare, current-operating retail classification and marker identity validation required. No database mutations.'},null,2))
 return sources
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&!process.argv.includes('--compare')&&!process.argv.includes('--recover'))await collect()
export async function compare(){
 const sourceIndex=JSON.parse(await readFile(out+'/source-index.json','utf8'))
 const db=JSON.parse(await readFile(process.env.LICENSE_DB_BASELINE||'artifacts/drugstores-nationwide-after-2026-10-03/database-before.json','utf8'))
 const norm=s=>String(s||'').normalize('NFKC').replace(/[\s\u3000]/g,'').replace(/丁目|番地|番|号/g,'-').replace(/[‐‑−―ー]/g,'-').replace(/-+/g,'-').replace(/-$/,'')
 const configs=[['kyoto-city-retail','京都府',1,2,-1,0,3],['shiga-retail','滋賀県',3,5,8,1,2],['otsu-current-retail','滋賀県',2,4,5,0,1],['431001_seisaku35-4','熊本県',2,3,-1,1,4],['430005_00426','熊本県',2,3,-1,0,1],['401005_tenpohanbaigyo','福岡県',5,7,8,2,9]]
 const rows=[]
 for(const [id,pref,n,a,p,permit,owner] of configs){
  const raw=Object.values(JSON.parse(await readFile(out+'/sources/'+id+'.rows.json','utf8')))[0]
  for(const r of raw.slice(1)){
   if(!r[n]||!r[a])continue
   const address=r[a].startsWith(pref)?r[a]:pref+r[a]
   const row={id:'license-'+id+'-'+r[permit],name:r[n],address,pref,phone:p<0?'':r[p],permit:r[permit],owner:r[owner],sourceUrl:sourceIndex.find(s=>s.id===id).url,licensingScope:sourceIndex.find(s=>s.id===id).scope,classification:'licensed-human-medicine-retail',status:'requires-current-operation-and-entity-marker'}
   const same=db.filter(d=>d.pref===pref&&norm(d.address)===norm(address))
   const identity=same.find(d=>norm(d.name)===norm(row.name)||norm(d.name).includes(norm(row.name))||norm(row.name).includes(norm(d.name)))
   row.dbMatch=identity?{id:identity.id,method:'name-and-normalized-exact-address'}:same.length?{candidateIds:same.map(d=>d.id),method:'same-address-identity-unconfirmed'}:null
   rows.push(row)
  }
 }
 await writeFile(out+'/license-rows.json',JSON.stringify(rows,null,2))
 await writeFile(out+'/pending.json',JSON.stringify(rows.filter(r=>!r.dbMatch||r.dbMatch.method!=='name-and-normalized-exact-address'),null,2))
 await writeFile(out+'/comparison.json',JSON.stringify({baseline:process.env.LICENSE_DB_BASELINE||'artifacts/drugstores-nationwide-after-2026-10-03/database-before.json',baselineCount:db.length,rows:rows.length,exactIdentityMatches:rows.filter(r=>r.dbMatch?.method==='name-and-normalized-exact-address').length,sameAddressUnconfirmed:rows.filter(r=>r.dbMatch?.method==='same-address-identity-unconfirmed').length,noExactAddressMatch:rows.filter(r=>!r.dbMatch).length,bySource:Object.fromEntries(configs.map(([id])=>[id,rows.filter(r=>r.id.startsWith('license-'+id+'-')).length]))},null,2))
 console.log('Compared',rows.length)
}
if(process.argv.includes('--compare'))await compare()


export async function recover(){
 const {createFetcher,validateStore}=await import('./crawl-national-stores.mjs')
 const {parseOfficialEmbedMarker,verifyMarkerAddress}=await import('./official-embed-marker.mjs')
 const fetcher=await createFetcher(out,false,true),pending=JSON.parse(await readFile(out+'/pending.json','utf8'))
 const selected=pending.filter(r=>r.phone&&r.dbMatch===null&&/薬店|セイシン|漢方/.test(r.name)).slice(0,20),stores=[],attempts=[]
 for(let offset=0;offset<selected.length;offset+=4){
  await Promise.all(selected.slice(offset,offset+4).map(async row=>{
   const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja'
   try{const page=await fetcher(url);const marker=parseOfficialEmbedMarker(page.html,row);verifyMarkerAddress(marker,row);stores.push(validateStore({...row,...marker,chain_name:'独立薬店',coordinateSourceUrl:url,collectedAt:new Date().toISOString()}));attempts.push({id:row.id,status:'accepted'})}catch(e){attempts.push({id:row.id,status:'pending',reason:e.message})}
  }))
  await writeFile(out+'/stores.json',JSON.stringify(stores,null,2));await writeFile(out+'/marker-attempts.json',JSON.stringify(attempts,null,2));console.log('markers',attempts.length,'accepted',stores.length)
 }
}
if(process.argv.includes('--recover'))await recover()
