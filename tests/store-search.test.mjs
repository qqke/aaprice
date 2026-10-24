import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
const source = readFileSync(new URL("../src/lib/aprice-api.mjs", import.meta.url), "utf8")
const start = source.indexOf("export async function searchStores(")
const handler = source.slice(start, source.indexOf("\nexport async function fetchPricesForProduct", start)).replaceAll("export ", "")
test("store search sends literal terms, global location and physical filter with bounded public reads", async () => {
  const calls = []
  const api = new Function("rpc", "request", `${handler}; return {searchStores,fetchStoresByIds}`)(
    async (name, body) => { calls.push({ name, body }); return [{ id: "global-store" }] },
    async (name, body) => { calls.push({ name, body }); return [] },
  )
  assert.deepEqual(await api.searchStores(' 名称%_"(), ', 900, 30, { location: {lat:35,lng:139}, physicalOnly:true }), [{ id: "global-store" }])
  assert.deepEqual(calls[0], { name:"search_public_stores", body:{payload:{query:'名称%_"(),',limit:500,offset:30,physical_only:true,lat:35,lng:139}} })
  await api.searchStores("", 30, -1, { location:{lat:null,lng:null} })
  assert.equal(calls[1].body.payload.lat, undefined)
  assert.equal(calls[1].body.payload.offset, 0)
  assert.deepEqual(await api.fetchStoresByIds([]), [])
  assert.equal(calls.length, 2)
  await api.fetchStoresByIds(['s"1', 's"1', ""])
  assert.equal(calls[2].body.query.limit, 1)
  assert.equal(calls[2].body.query.id, 'in.("s\\"1")')
  await api.fetchStoresByIds(Array.from({length:201},(_,i)=>`store-${i}`))
  assert.deepEqual(calls.slice(3).map(call=>call.body.query.limit),[100,100,1])
})
