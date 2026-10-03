import test from 'node:test'
import assert from 'node:assert/strict'
import {parseGenkyEmbeddedMarker} from '../scripts/crawl-genky-directory.mjs'

test('Genky fallback requires its official selected entity, branch name and locality',()=>{
  const mapUrl='https://www.google.com/maps/embed?pb=!1s0xabc%3A0xdef'
  const html='[["0xabc:0xdef","石川県珠洲市野々江町 ゲンキー野々江店",[37.442,137.273]], [37,137]]'
  const row={name:'ゲンキー野々江店',address:'石川県珠洲市野々江町サ部79',hours:'9:00–21:00'}
  assert.equal(parseGenkyEmbeddedMarker(html,mapUrl,row).lat,37.442)
  assert.throws(()=>parseGenkyEmbeddedMarker(html,mapUrl,{...row,name:'ゲンキー別店'}),/name differs/)
  assert.throws(()=>parseGenkyEmbeddedMarker(html,mapUrl,{...row,address:'石川県金沢市1-1'}),/locality differs/)
  assert.throws(()=>parseGenkyEmbeddedMarker(html,mapUrl.replace('0xdef','0xbeef'),row),/matching place marker/)
})
