import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {databaseProcess} from './sync-sundrug.mjs'
import {canonicalStoreIdentity,possibleExistingBranches,indexExistingBranches} from './drugstore-identity.mjs'
import {validateStore} from './crawl-national-stores.mjs'

const out = process.argv.find(x => x.startsWith('--out='))?.slice(6) || 'artifacts/drugstores-audit-2026-10-03'
await mkdir(out, {recursive:true})
const raw = databaseProcess(process.env.AAPRICE_DB_URL, "\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from (select id,name,chain_name,address,pref,city,lat,lng,hours from public.stores order by id) s;")
const before = JSON.parse(raw.slice(raw.indexOf('[')))
await writeFile(`${out}/database-before.json`, JSON.stringify(before,null,2))
const reviewIndex=indexExistingBranches(before)
const byId = new Map(before.map(s => [s.id,s]))
const identities = new Map()
for (const s of before) {
  const key = canonicalStoreIdentity(s)
  if (!identities.has(key)) identities.set(key,[])
  identities.get(key).push(s.id)
}
const sources = []
for (const file of process.argv.slice(2).filter(x => !x.startsWith('--'))) {
  const rows = JSON.parse(await readFile(file,'utf8'))
  const missing = [], ambiguous = [], matched = [], ineligible = []
  for (const s of rows) {
    try {
      validateStore(s)
      if(s.coordinateAccuracy==='map-center'||s.coordinateStatus==='precise-location-unverified')throw Error('Unverified store coordinates')
    } catch(e) {ineligible.push({id:s.id,reason:e.message});continue}
    const candidates = identities.get(canonicalStoreIdentity(s)) || []
    if (byId.has(s.id)) matched.push({sourceId:s.id,existingId:s.id})
    else if (candidates.length === 1) matched.push({sourceId:s.id,existingId:candidates[0]})
    else if (candidates.length > 1) ambiguous.push({...s,existingIds:candidates})
    else {
      const possible=possibleExistingBranches(s,reviewIndex)
      if(possible.length)ambiguous.push({...s,existingIds:possible,reason:'Possible move or rebranding'})
      else missing.push(s)
    }
  }
  const index = sources.length
  await writeFile(`${out}/missing-${index}.json`,JSON.stringify(missing,null,2))
  await writeFile(`${out}/ambiguous-${index}.json`,JSON.stringify(ambiguous,null,2))
  await writeFile(`${out}/ineligible-${index}.json`,JSON.stringify(ineligible,null,2))
  sources.push({file,officialValid:rows.length-ineligible.length,ineligible:ineligible.length,matched:matched.length,missing:missing.length,ambiguous:ambiguous.length})
}
const report = {checkedAt:new Date().toISOString(),databaseRows:before.length,chains:new Set(before.map(s=>s.chain_name)).size,
  scope:'Supplied official retail directories; historical database rows include pharmacies and online stores.',
  chainCounts:Object.fromEntries([...new Set(before.map(s=>s.chain_name))].sort().map(n=>[n,before.filter(s=>s.chain_name===n).length])),
  duplicateIdentities:[...identities].filter(([,ids])=>ids.length>1).map(([identity,ids])=>({identity,ids})),sources}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
console.log(JSON.stringify({...report,chainCounts:undefined,duplicateIdentities:report.duplicateIdentities.length}))
