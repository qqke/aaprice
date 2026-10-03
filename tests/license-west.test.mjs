import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {verifyMarkerAddress} from '../scripts/official-embed-marker.mjs'
test('Western licensing recovery preserves exact entity and permit evidence',{skip: !process.env.AAPRICE_CRAWL_ARTIFACT_TESTS},async()=>{
 const rows=JSON.parse(await readFile('artifacts/drugstores-license-west-2026-10-03/license-rows.json'))
 const stores=JSON.parse(await readFile('artifacts/drugstores-license-west-2026-10-03/stores.json'))
 assert.equal(rows.length,1454);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length)
 for(const store of stores){assert(rows.some(r=>r.id===store.id&&r.address===store.address&&r.phone===store.phone));verifyMarkerAddress(store,store);assert(store.coordinateEntityName);assert(store.coordinateEntityId);assert.match(store.coordinateSourceUrl,/google.com\/maps\?q=/);assert(store.lat>20&&store.lat<46&&store.lng>122&&store.lng<154)}
})
