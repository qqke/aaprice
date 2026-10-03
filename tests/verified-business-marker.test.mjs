import assert from 'node:assert/strict'
import {parseOfficialFeatureMarker,parseWebsiteVerifiedMarker} from '../scripts/official-embed-marker.mjs'
const row={name:'ザグザグ 笠岡富岡店',phone:'0865-67-3346',address:'岡山県笠岡市富岡271-1',sourceUrl:'https://www.zagzag.co.jp/shops/k_tomioka/'}
const entity=[['0x35516a5e70d6dc6d:0x2a0482b83d7b16c2','ZAGZAG',[34.4949951,133.526553],'123'],'ザグザグ 笠岡富岡店']
entity[11]=['/url?q=https://www.zagzag.co.jp/','zagzag.co.jp'];entity[13]='〒714-0092 岡山県笠岡市富岡271-1'
const html=value=>`initEmbed(${JSON.stringify([value])});`
const map='https://www.google.com/maps/embed?pb=!1s0x35516a5e70d6dc6d%3A0x2a0482b83d7b16c2'
assert.equal(parseWebsiteVerifiedMarker(html(entity),row).lat,34.4949951)
assert.throws(()=>parseWebsiteVerifiedMarker(html(entity),{...row,sourceUrl:'https://mall.example.com/'}),/website/)
assert.throws(()=>parseWebsiteVerifiedMarker(html(entity),{...row,name:'別店舗'}),/branch/)
assert.equal(parseOfficialFeatureMarker(html(entity),map,row).lat,34.4949951)
assert.throws(()=>parseOfficialFeatureMarker(html(entity),map.replace('16c2','16c3'),row),/feature/)
assert.throws(()=>parseOfficialFeatureMarker(html(entity),map,{...row,address:'岡山県笠岡市富岡271-2'}),/numbers differ/)
const mall=structuredClone(entity);mall[1]='ショッピングモール'
assert.throws(()=>parseOfficialFeatureMarker(html(mall),map,row),/branch/)
console.log('Business marker fallback: official website or exact official feature plus branch/address, malls rejected')
