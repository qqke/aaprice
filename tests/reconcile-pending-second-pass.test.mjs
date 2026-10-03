import assert from 'node:assert/strict'
import {reviewedAddress} from '../scripts/reconcile-pending-second-pass.mjs'
const row={id:'ainz-0185',address:'東京都練馬区光が丘5丁目1-1 光が丘IMA2F'},observation={address:'Ima, ５丁目-１-１ 光が丘 練馬区 東京都 179-0072'}
assert.equal(reviewedAddress(row,observation).ordered,'東京都練馬区光が丘5丁目-1-1')
assert.throws(()=>reviewedAddress({...row,address:'東京都練馬区光が丘5丁目1-2'},observation),/numbers differ/)
assert.throws(()=>reviewedAddress(row,{address:'Ima, ５丁目-１-２ 光が丘 練馬区 東京都 179-0072'}),/changed/)
assert.throws(()=>reviewedAddress({...row,id:'unreviewed'},observation),/individually/)
console.log('Individually reviewed reverse address accepted only with unchanged exact street/lot; other lots/unknown rows rejected')
