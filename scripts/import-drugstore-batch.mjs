import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {buildImportSql} from './crawl-drugstores.mjs'
import {validateStore} from './crawl-national-stores.mjs'
import {databaseProcess} from './sync-sundrug.mjs'
import {canonicalStoreIdentity} from './drugstore-identity.mjs'
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-parallel-2026-09-13'
await mkdir(out,{recursive:true})
const files=process.argv.slice(2).filter(x=>!x.startsWith('--'))
if(!files.length)throw Error('Pass stores.json files to import')
const snapshot=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from (select id,name,chain_name,address,pref,city,lat,lng,hours from public.stores order by id) s;")
const before=JSON.parse(snapshot.slice(snapshot.indexOf('[')))
await writeFile(`${out}/database-before.json`,JSON.stringify(before,null,2))
const existing=new Map(before.map(s=>[s.id,s])),rows=new Map(),excluded=[]
const norm=s=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')
const identities=new Map(before.map(s=>[norm(s.name)+norm(s.address),s.id]))
const canonical=new Map(),remapped=[]
for(const row of before){const key=canonicalStoreIdentity(row);if(!canonical.has(key))canonical.set(key,new Set());canonical.get(key).add(row.id)}
for(const file of files){for(const s of JSON.parse(await readFile(file,'utf8'))){
 try{
  if(s.coordinateAccuracy==='map-center'||s.coordinateStatus==='precise-location-unverified')throw Error('Approximate map center is not a verified store position')
  validateStore(s)
  const matches=canonical.get(canonicalStoreIdentity(s))
  if(!existing.has(s.id)&&matches?.size){
    if(matches.size!==1)throw Error('Ambiguous existing canonical branch identity')
    const id=[...matches][0],prior=existing.get(id)||rows.get(id)
    remapped.push({sourceId:s.id,existingId:id,file})
    rows.set(id,{...s,id,name:prior.name,chain_name:prior.chain_name,city:prior.city||s.city})
    continue
  }
  const identity=norm(s.name)+norm(s.address),duplicate=identities.get(identity)
  if(duplicate&&duplicate!==s.id)throw Error(`Duplicate name and address of ${duplicate}`)
  rows.set(s.id,s);identities.set(identity,s.id)
  const canonicalKey=canonicalStoreIdentity(s)
  if(!canonical.has(canonicalKey))canonical.set(canonicalKey,new Set())
  canonical.get(canonicalKey).add(s.id)
 }catch(e){excluded.push({file,id:s.id,reason:e.message})}
}}
const stores=[...rows.values()]
await writeFile(`${out}/stores.json`,JSON.stringify(stores,null,2))
const sql=buildImportSql([],stores)
await writeFile(`${out}/import.sql`,sql)
const report={generatedAt:new Date().toISOString(),inputs:files,beforeCount:before.length,accepted:stores.length,newIds:stores.filter(s=>!existing.has(s.id)).length,existingIds:stores.filter(s=>existing.has(s.id)).length,remapped,excluded,applied:false}
if(process.argv.includes('--apply')){
 databaseProcess(process.env.AAPRICE_DB_URL,sql)
 const query='\\pset tuples_only on\n\\pset format unaligned\nselect json_build_object(\'stores\',count(*),\'chains\',count(distinct chain_name)) from public.stores;'
 const result=databaseProcess(process.env.AAPRICE_DB_URL,query)
 report.after=JSON.parse(result.slice(result.indexOf('{')));report.applied=true
}
await writeFile(`${out}/import-report.json`,JSON.stringify(report,null,2))
console.log(JSON.stringify({...report,excluded:excluded.length,remapped:remapped.length}))
