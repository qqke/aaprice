import test from 'node:test'
import assert from 'node:assert/strict'
import {naviiOTCStock} from '../scripts/crawl-membership-b-recovery.mjs'
test('OTC inventory uses actual result cell, never explanatory risk-class digits',()=>{assert.equal(naviiOTCStock('<tr><th>要指導医薬品・一般用医薬品の取扱品目数 第1類~第3類</th><td>12</td></tr>'),12);assert.equal(naviiOTCStock('<tr><th>要指導医薬品・一般用医薬品の取扱品目数 第1類~第3類</th><td>0</td></tr>'),0);assert.equal(naviiOTCStock('<tr><th>薬局医薬品の取扱品目数</th><td>300</td></tr>'),null);assert.equal(naviiOTCStock('<tr><th>要指導医薬品・一般用医薬品の取扱品目数 第1類~第3類</th><td>-</td></tr>'),null)})
