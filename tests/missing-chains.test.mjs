import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEmbeddedMarker,parseKomeyaName,parseCares} from '../scripts/crawl-missing-chains.mjs'

test('Komeya uses official branch metadata instead of the generic company title',()=>{
  assert.equal(parseKomeyaName('<title>株式会社コメヤ薬局</title><meta property="og:title" content="ドラッグストアコメヤ根上店 - 株式会社コメヤ薬局">'),'ドラッグストアコメヤ根上店')
  assert.throws(()=>parseKomeyaName('<title>株式会社コメヤ薬局</title>'),/Missing official store name/)
})
test('Cares Nagaokakyo branch belongs to Kyoto rather than the surrounding Osaka directory',()=>{
  const rows=parseCares('<li class="shadow pd40 store mb60"><h3>ケアーズドラッグ長岡今里店</h3><dt>所在地</dt><dd>長岡京市今里西ノ口10-4</dd></li>','2026-10-03')
  assert.equal(rows[0].address,'京都府長岡京市今里西ノ口10-4')
})
test('Official embedded feature coordinates never come from viewport or another business',()=>{
  const html='[["0xaaa:0xbbb","別店",[35.1,135.1]],[["0xccc:0xddd","石川県コメヤ店",[36.1,136.1]]'
  const marker=parseEmbeddedMarker(html,'https://www.google.com/maps/embed?pb=!1s0xccc:0xddd')
  assert.equal(marker.lat,36.1)
  assert.throws(()=>parseEmbeddedMarker(html,'https://www.google.com/maps/embed?pb=!1s0xeee:0xfff'),/Missing or ambiguous/)
  assert.throws(()=>parseEmbeddedMarker(html,'https://www.google.com/maps/embed?pb=!3d36.1!4d136.1'),/does not identify/)
})
