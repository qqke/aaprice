import test from 'node:test'
import assert from 'node:assert/strict'
import {parseMiyagiCoopBranch} from '../scripts/crawl-miyagi-coop.mjs'

test('Miyagi Coop uses exact branch drug evidence and never duplicates an existing prefecture prefix',()=>{
  const html=(address,hours)=>`<div class="pageTitle pageTitle2"><h2><span>大河原店</span></h2></div><p class="detail-address2">${address}</p><p class="detail-tel2">0224（51）3500</p><p class="detail-time2">${hours}</p>`
  const parse=h=>parseMiyagiCoopBranch(h,'https://www.miyagi.coop/shop/shoplist/store.php?shop=35','2026-10-13T00:00:00Z')
  for(const address of ['宮城県柴田郡大河原町字広表22番地3','柴田郡大河原町字広表22番地3'])
    assert.equal(parse(html(address,'【直営薬店営業時間】10：00～19：00')).address,'宮城県柴田郡大河原町字広表22番地3')
  assert.equal(parse(html('柴田郡大河原町字広表22番地3','9:00～21:30')+'直営薬店の営業時間は店舗により異なります'),null)
  assert.match(parse(html('柴田郡大河原町字広表22番地3','直営薬店は休業')).reason,/closure\/status/)
  assert.throws(()=>parse(html('','直営薬店10:00～19:00')))
})
