import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createFetcher, validateStore } from './crawl-national-stores.mjs'
import { parseKeimeidoRetailers } from './crawl-keimeido-retailers.mjs'
import { parseOfficialEmbedMarker, verifyMarkerAddress } from './official-embed-marker.mjs'
import { normalizeAddress } from './crawl-eastern-license-registry.mjs'
import { databaseProcess } from './sync-sundrug.mjs'

const out = 'artifacts/drugstores-keimeido-same-address-2026-10-03'
const hash = value => createHash('sha256').update(value).digest('hex')
const names = /^(コクミン|ハッピードラッグ|スーパードラッグアサヒ|スーパーシティアサヒ|薬王堂|マルトパワードラッグ|ココカラファイン|薬 マツモトキヨシ)/
await mkdir(out, { recursive: true })
const ledger = JSON.parse(await readFile('artifacts/drugstores-keimeido-retailers-2026-10-03/directory-ledger.json', 'utf8'))
const selected = ledger.filter(row => row.status === 'same-address-review' && row.phone && names.test(row.name)).slice(0, 80)
const dbRaw = databaseProcess(process.env.AAPRICE_DB_URL, "\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from (select id,name,address,lat,lng from public.stores) s;")
const db = JSON.parse(dbRaw.slice(dbRaw.indexOf('[')))
const get = await createFetcher(out, false, true)
const stores = [], pending = []
for (const row of selected) {
  try {
    const source = await get(row.sourceUrl)
    const parsed = parseKeimeidoRetailers(source.html, row.sourceUrl, source.collectedAt).find(item => item.id === row.id)
    if (!parsed || !parsed.products.length || parsed.phone !== row.phone) throw new Error('Source row or OTC product proof changed')
    const url = 'https://www.google.com/maps?q=' + encodeURIComponent(row.name + ' ' + row.address) + '&output=embed&hl=ja'
    const map = await get(url)
    const marker = parseOfficialEmbedMarker(map.html, row)
    verifyMarkerAddress(marker, { ...row, address: normalizeAddress(row.address) })
    const nearby = db.filter(existing => Math.hypot((existing.lat - marker.lat) * 111320, (existing.lng - marker.lng) * 111320 * Math.cos(marker.lat * Math.PI / 180)) < 60)
    if (!nearby.length) throw new Error('Expected same-address existing entity missing')
    stores.push(validateStore({ ...parsed, ...marker, coordinateSourceUrl: url, coordinateCollectedAt: map.collectedAt, colocatedWith: nearby.map(item => item.id), distinctOfficialPhone: true }))
  } catch (error) {
    pending.push({ ...row, reason: error.message })
  }
}
await writeFile(out + '/stores.json', JSON.stringify(stores, null, 2))
await writeFile(out + '/pending.json', JSON.stringify(pending, null, 2))
await writeFile(out + '/report.json', JSON.stringify({ selected: selected.length, accepted: stores.length, pending: pending.length, databaseRows: db.length, strictSourceProductAndMapEntity: true, nationalComplete: false }, null, 2))
console.log(JSON.stringify({ selected: selected.length, accepted: stores.length, pending: pending.length }))
