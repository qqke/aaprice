import assert from 'node:assert/strict'
import {parseOfficialEmbedMarker} from '../scripts/official-embed-marker.mjs'
const row={name:'ザグザグ 笠岡富岡店',phone:'0865-67-3346'}
const entity=[['0x35516a5e70d6dc6d:0x2a0482b83d7b16c2','ZAG ZAG',[34.4949951,133.526553],'123'],'ザグザグ 笠岡富岡店',null,'0865-67-3346']
const html=value=>`initEmbed(${JSON.stringify(value)});`
assert.deepEqual([parseOfficialEmbedMarker(html([[100,133.52633779,34.49463359],entity]),row).lat,parseOfficialEmbedMarker(html([entity]),row).lng],[34.4949951,133.526553])
assert.throws(()=>parseOfficialEmbedMarker(html([[100,133.52633779,34.49463359]]),row),/matching official phone/)
assert.throws(()=>parseOfficialEmbedMarker(html([entity]),{...row,phone:'000-000-0000'}),/matching official phone/)
assert.throws(()=>parseOfficialEmbedMarker(html([entity]),{...row,name:'ザグザグ 別店舗'}),/name differs/)
assert.throws(()=>parseOfficialEmbedMarker(html([entity,entity]),row),/exactly one entity/)
const international=structuredClone(entity);international[3]='+81 865 67 3346'
assert.equal(parseOfficialEmbedMarker(html([international]),row).lat,34.4949951)
console.log('Official embed marker: identity checked, viewport rejected')
