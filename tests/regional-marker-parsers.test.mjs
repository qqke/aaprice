import assert from 'node:assert/strict'
import {parseArka} from '../scripts/crawl-arka-directory.mjs'
import {parseYam} from '../scripts/crawl-yamazawa.mjs'
const arka='<dt><span>店舗名</span></dt><dd><p>アルカドラッグ テスト店</p></dd><dt><span>住所</span></dt><dd><p>兵庫県神戸市中央区1-1</p></dd>'
const url='https://arka.co.jp/detail.php?shop_id=d001'
assert(parseArka(arka+'center:new google.maps.LatLng(34,135)',url,'').pending)
assert(parseArka(arka+'var pinLatlng = new google.maps.LatLng(34,135); position:pinLatlng',url,'').store)
assert(parseArka(arka.replace('アルカドラッグ','アルカ調剤薬局'),url,'').excluded)
const yam=parseYam('<h1>店舗案内</h1><h2>ドラッグヤマザワ新庄宮内店</h2><th>住所</th><td>〒996-0001 山形県新庄市五日町272-1</td><th>TEL</th><td>0233-28-0606</td><iframe src="https://www.google.com/maps/embed?pb=!2d140.2!3d38.7">','https://www.yamazawa-drg.co.jp/shop/shinjo-miyauchi','')
assert.equal(yam.pending.name,'ドラッグヤマザワ新庄宮内店')
assert.equal(yam.pending.address,'山形県新庄市五日町272-1')
assert.equal(yam.pending.phone,'0233-28-0606')
assert.equal(yam.pending.lat,null)
console.log('Regional parsers: retail identity and explicit marker required')
