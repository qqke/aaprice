import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEarthProduct} from '../scripts/crawl-earth-products.mjs'
const url='https://www.earth.jp/products/nomat-60-whiteblue/index.html'
const base='<h1 class="product2-head--ttl">アースノーマット 60日セット ホワイトブルー</h1><meta property="og:image" content="https://www.earth.jp/products/nomat-60-whiteblue/images/0046560T_4901080122711_03.jpg">'
const shop=code=>`<div class="product2-info--main-shop"><a href="https://item.rakuten.co.jp/rakuten24/${code}/">buy</a><!-- 製品DB連携エリア - オンラインストア END -->`
test('Earth requires current main purchase JAN corroborated by own main image',()=>{
  assert.equal(parseEarthProduct(base+shop('4901080122711'),url).barcode,'4901080122711')
  assert.throws(()=>parseEarthProduct(base+shop('4901080148315'),url))
  assert.throws(()=>parseEarthProduct(base+'<div class="recommended"><a href="https://item.rakuten.co.jp/rakuten24/4901080122711/">other</a></div>',url))
  assert.throws(()=>parseEarthProduct(base+shop('4901080122711').replace('<!--','<a href="https://item.rakuten.co.jp/rakuten24/4901080148315/">other</a><!--'),url))
})
