import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProduct } from './crawl-soft99-products.mjs'

test('explicit JAN and same-page name, pack and main image are required', () => {
  const html = '<link rel="canonical" href="https://www.soft99.co.jp/products/detail/00287/"><meta property="og:image" content="https://www.soft99.co.jp/uploadimg/00287_b.jpg"><img src="/uploadimg/00287_b.jpg" alt="メイン写真"><table class="productTable"><tr><th>商品名</th><td>コートもできるクリーナー &#x26; &lt;MODEL&gt;</td></tr><tr><th>JANコード</th><td>4975759002871</td></tr><tr><th>内容</th><td>230g</td></tr></table>'
  const url = 'https://www.soft99.co.jp/products/detail/00287/'
  const row = parseProduct(html, url)
  assert.equal(row.barcode, '4975759002871')
  assert.equal(row.pack, '230g')
  assert.equal(row.imageUrl, 'https://www.soft99.co.jp/uploadimg/00287_b.jpg')
  assert.match(row.name, /コートもできるクリーナー/)
  assert.match(row.name, /& <MODEL>/)
  assert.match(parseProduct(html.replace('4975759002871', '4975759002872'), url).reason, /invalid explicit JAN/)
  assert.match(parseProduct(html.replace('JANコード</th>', '商品コード</th>'), url).reason, /identity fields/)
  assert.match(parseProduct(html + html, url).reason, /multiple main/)
  assert.match(parseProduct(html.replace('</table>', '<tr><th>JANコード</th><td>4975759002871</td></tr></table>'), url).reason, /duplicate identity/)
  assert.match(parseProduct(html.replace('00287_b', '00288_b'), url).reason, /identity mismatch/)
  assert.match(parseProduct(html, url.replace('00287', '00288')).reason, /identity mismatch/)
})
