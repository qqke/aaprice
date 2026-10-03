import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createFetcher, validateStore } from './crawl-national-stores.mjs'
import { parseKeimeidoRetailers } from './crawl-keimeido-retailers.mjs'
import { parseOfficialEmbedMarker, verifyMarkerAddress } from './official-embed-marker.mjs'
import { normalizeAddress } from './crawl-eastern-license-registry.mjs'
import { databaseProcess } from './sync-sundrug.mjs'

const out = 'artifacts/drugstores-keimeido-colocated-2026-10-03'
const hash = value => createHash('sha256').update(value).digest('hex')
const targets = [
  ['keimeido-2a3215cf99e27e98', 'ひろこうじ薬局', '千葉県流山市流山9-800-2 イトーヨーカ堂流山店 1F', '04-7158-2115', 'https://www.keimeido.co.jp/shop/chiba'],
  ['keimeido-92c630c7861fa4f2', '大由', '奈良県大和高田市片塩町8-27', '0745-53-2256', 'https://www.keimeido.co.jp/shop/nara']
]

await mkdir(out, { recursive: true })
const get = await createFetcher(out, false, true)
const sourceRows = []
const accepted = []
const dbRaw = databaseProcess(process.env.AAPRICE_DB_URL, "\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from (select id,name,address,lat,lng from public.stores) s;")
const db = JSON.parse(dbRaw.slice(dbRaw.indexOf('[')))
for (const [id, name, address, phone, sourceUrl] of targets) {
  const source = await get(sourceUrl)
  const row = parseKeimeidoRetailers(source.html, sourceUrl, source.collectedAt).find(item => item.id === id)
  if (!row || row.name !== name || normalizeAddress(row.address) !== normalizeAddress(address) || row.phone !== phone || !row.products.length) throw new Error(`Primary identity or OTC proof changed: ${name}`)
  const mapUrl = 'https://www.google.com/maps?q=' + encodeURIComponent(name + ' ' + address) + '&output=embed&hl=ja'
  const map = await get(mapUrl)
  const marker = parseOfficialEmbedMarker(map.html, row)
  verifyMarkerAddress(marker, { ...row, address: normalizeAddress(address) })
  const near = db.filter(existing => Math.hypot((existing.lat - marker.lat) * 111320, (existing.lng - marker.lng) * 111320 * Math.cos(marker.lat * Math.PI / 180)) < 60)
  if (!near.length) throw new Error(`Expected colocated review missing: ${name}`)
  accepted.push(validateStore({ ...row, ...marker, coordinateSourceUrl: mapUrl, coordinateCollectedAt: map.collectedAt, colocatedWith: near.map(item => item.id), colocatedDistinctPhone: true }))
  sourceRows.push({ id, name, address, phone, existingNearby: near.map(item => ({ id: item.id, name: item.name, address: item.address })) })
}
await writeFile(out + '/stores.json', JSON.stringify(accepted, null, 2))
await writeFile(out + '/review.json', JSON.stringify({ databaseRows: db.length, targets: sourceRows, distinctEntityEvidence: true, strictCoordinates: true, sourceRowsHash: hash(JSON.stringify(sourceRows)) }, null, 2))
console.log(JSON.stringify({ accepted: accepted.length, colocated: sourceRows }))
