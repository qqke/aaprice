import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createFetcher} from '../scripts/crawl-national-stores.mjs'

test('fetcher retries transient failures, caches success and never retries denied or untrusted requests',async t=>{
  const out=await mkdtemp(join(tmpdir(),'aaprice-fetch-')),calls={stores:0,denied:0,tls:0,later:0}
  t.after(async()=>{assert(resolve(out).startsWith(resolve(tmpdir())+sep));await rm(out,{recursive:true,force:true})})
  t.mock.method(globalThis,'fetch',async url=>{
    const path=new URL(url).pathname
    if(path==='/robots.txt')return new Response('',{status:404})
    if(path==='/stores') {
      calls.stores++
      if(calls.stores===1)throw new DOMException('timeout','TimeoutError')
      return calls.stores===2?new Response('busy',{status:503}):new Response('[{"id":"1"}]')
    }
    if(path==='/denied'){calls.denied++;return new Response('denied',{status:403})}
    if(path==='/tls'){calls.tls++;throw new TypeError('fetch failed',{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}})}
    calls.later++;return new Response('later',{status:503,headers:{'retry-after':'3600'}})
  })
  const get=await createFetcher(out)
  assert.equal((await get('https://example.com/stores')).html,'[{"id":"1"}]')
  assert.equal((await get('https://example.com/stores')).html,'[{"id":"1"}]')
  assert.equal(calls.stores,3)
  await assert.rejects(get('https://example.com/denied'),/HTTP 403/);assert.equal(calls.denied,1)
  await assert.rejects(get('https://example.com/tls'),/fetch failed/);assert.equal(calls.tls,1)
  await assert.rejects(get('https://example.com/later'),/HTTP 503/);assert.equal(calls.later,1)
})
