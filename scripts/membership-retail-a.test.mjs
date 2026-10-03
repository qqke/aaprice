import test from 'node:test'
import assert from 'node:assert/strict'
import {parseAobado,parseKashiwaba,parseOhtemachi,visibleHtml} from './crawl-membership-retail-a.mjs'
test('commented historical branch is never enumerated',()=>{
 const branch=(name)=>`<h3>${name}</h3><tr><th>所在地</th><td>横浜市中区柏葉33</td></tr><tr><th>電話</th><td>045-641-5413</td></tr>`
 const rows=parseKashiwaba(`<!--${branch('羽衣町店')}-->${branch('柏葉店')}${branch('阪東橋店(調剤専門)')}`,'http://www.kashiwaba-ph.com/110.html')
 assert.equal(rows.length,2);assert.equal(rows[0].name,'カシワバ薬局 柏葉店');assert.equal(rows[1].reason,'dispensing-only-excluded')
 assert.equal(visibleHtml('a<!--dead-->b'),'ab')
})
test('branch OTC evidence requires enabled icon and restores regional prefecture',()=>{
 const branch=state=>`<li><div class="box"><h3>青葉堂薬局・例店</h3><div class="address">〒700-0001 岡山市北区例町1-2</div><div class="tel">TEL 086-111-2222</div><div class="status-icon ${state}"><img alt="要指導医薬品販売"></div><a class="btn01" href="https://aobado.jp/shop/example/"></a></div></li>`
 const rows=parseAobado(branch('on')+branch('off'),'https://aobado.jp/shop-area/okayama-area/')
 assert.equal(rows[0].address,'岡山県岡山市北区例町1-2');assert.equal(rows[0].reason,null);assert.equal(rows[1].reason,'branch-OTC-scope-review')
})
test('company business is insufficient without exact branch retail evidence',()=>{
 const html='一般医薬品販売 メディカル例 所在地 〒708-0001 岡山県津山市例町1-2 TEL 0868-11-2222 FAX 0868-11-3333 主な応需科目 内科 アクセス メディカル漢方 所在地 〒708-0002 岡山県津山市例町2-3 TEL 0868-22-3333 FAX 0868-22-4444 【調剤併設型漢方相談薬局】 アクセス'
 const rows=parseOhtemachi(html,'https://www.ohtemachi-ph.com/group')
 assert.equal(rows.length,2);assert.equal(rows[0].reason,'branch-OTC-scope-review');assert.equal(rows[1].reason,'branch-OTC-scope-review');assert.match(rows[1].retailEvidence,/漢方相談薬局/)
})
