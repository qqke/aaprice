import test from 'node:test'
import assert from 'node:assert/strict'
import {parseShiseidoProduct, parseShiseidoSitemap} from '../scripts/crawl-shiseido-products.mjs'

test('Shiseido sitemap restricts enumeration to official product details', () => {
  const url = 'https://www.shiseido.co.jp/sw/onlinestore/products/H97301.html'
  assert.deepEqual(parseShiseidoSitemap(`<urlset><loc>${url}</loc><loc>${url}</loc></urlset>`), [url])
  assert.throws(() => parseShiseidoSitemap('<loc>https://example.com/products/1.html</loc>'), /unexpected/)
  assert.throws(() => parseShiseidoSitemap('<urlset/>'), /Empty/)
})

test('Shiseido uses the explicit Product JAN without requiring a published price', () => {
  const url = 'https://www.shiseido.co.jp/sw/onlinestore/products/H97301.html'
  const product = {'@type': 'Product', sku: '4514254243589', name: 'エッセンス ファンデーション',
    brand: {name: 'SHISEIDO メーキャップ'}, description: '<p>なめらかな肌に</p>', image: 'https://imagecdn.shiseido.co.jp/image.jpg', offers: {price: null}}
  const html = `<script type="application/ld+json">${JSON.stringify(product)}</script>`
  assert.deepEqual(parseShiseidoProduct(html, url), {barcode: product.sku, name: product.name, brand: product.brand.name,
    pack: '', category: '', description: 'なめらかな肌に', imageUrl: product.image, catalogSource: 'shiseido', sourceUrl: url})
  assert.throws(() => parseShiseidoProduct(html.replace(product.sku, '4514254243580'), url), /invalid JAN/)
  assert.throws(() => parseShiseidoProduct(html, 'https://example.com/'), /Unexpected/)
})
