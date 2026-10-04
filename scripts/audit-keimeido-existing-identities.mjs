import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { databaseProcess } from './sync-sundrug.mjs'
import { normalizeAddress } from './crawl-eastern-license-registry.mjs'

const arg = key => process.argv.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3)
const offset = Number(arg('offset') || 0), limit = Number(arg('limit') || 500)
const out = arg('out') || `artifacts/drugstores-keimeido-existing-${offset}-${offset + limit}-2026-10-04`
await mkdir(out, { recursive: true })
const ledger = JSON.parse(await readFile('artifacts/drugstores-keimeido-retailers-2026-10-03/directory-ledger.json', 'utf8'))
const rows = ledger.filter(row => row.status === 'existing-identity-review').slice(offset, offset + limit)
const raw = databaseProcess(process.env.AAPRICE_DB_URL, "\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from (select id,name,address,phone from public.stores) s;")
const db = new Map(JSON.parse(raw.slice(raw.indexOf('['))).map(row => [row.id, row]))
const checks = rows.map(row => {
  const matches = row.existingIds.map(id => db.get(id)).filter(Boolean)
  const addressMatch = matches.some(match => normalizeAddress(match.address) === normalizeAddress(row.address))
  const phoneMatch = matches.some(match => match.phone && row.phone && match.phone.replace(/\D/g, '') === row.phone.replace(/\D/g, ''))
  return { id: row.id, name: row.name, existingIds: row.existingIds, matchedDatabaseIds: matches.map(match => match.id), addressMatch, phoneMatch, covered: matches.length > 0 }
})
const result = { offset, selected: rows.length, covered: checks.filter(row => row.covered).length, addressMatch: checks.filter(row => row.addressMatch).length, phoneMatch: checks.filter(row => row.phoneMatch).length, unresolved: checks.filter(row => !row.covered).length, databaseRows: db.size, allRowsChecked: true }
await writeFile(`${out}/checks.json`, JSON.stringify(checks, null, 2))
await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
