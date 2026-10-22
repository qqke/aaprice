import assert from 'node:assert/strict'
import test from 'node:test'
import {parseVariants} from '../scripts/crawl-shiseido-variants.mjs'

const url = 'https://www.shiseido.co.jp/sw/onlinestore/products/H81401.html'
test('Shiseido parses verified nested variant JANs and shade names without treating model codes as JANs', () => {
  const result = parseVariants({shohin_name: 'リップグロウボム', brnd_mei: 'マキアージュ', sweb_shohin_cd: '4909978225766',
    pattern_3_list: [{sweb_shohin_cd: '4909978225766', shohin_zen_mei: 'リップグロウボム RS515'},
      {sweb_shohin_cd: '4909978225827', shohin_zen_mei: 'リップグロウボム PK215', irodama_gzfl_pth: '/products/image.jpg'},
      {sweb_shohin_cd: 'H81401'}, {sweb_shohin_cd: '4909978225828'}],
    pattern_2_5_list: [{colors: [{sweb_shohin_cd: '4909978225834', shohin_zen_mei: 'リップグロウボム BE215'}]}]}, url)
  assert.deepEqual(result.map(row => row.barcode), ['4909978225834', '4909978225766', '4909978225827'])
  assert.equal(result[1].name, 'リップグロウボム RS515')
  assert.equal(result[2].sourceUrl, `${url}?sweb_shohin_cd=4909978225827`)
  assert.match(result[2].imageUrl, /^https:\/\/imagecdn.shiseido.co.jp\//)
  const [photo] = parseVariants({shohin_name: '商品', sweb_shohin_cd: '4909978225827', irodama_gzfl_pth: '/products/shade.jpg'}, url, {imageUrl: 'https://imagecdn.shiseido.co.jp/main.jpg'})
  assert.equal(photo.imageUrl, 'https://imagecdn.shiseido.co.jp/main.jpg')
  const [variantPhoto] = parseVariants({shohin_name: '商品', sweb_shohin_cd: '4909978225827', shohin_pl_s_gzfl_pth_1: '/products/photo.jpg'}, url, {imageUrl: 'https://imagecdn.shiseido.co.jp/main.jpg'})
  assert.match(variantPhoto.imageUrl, /\/products\/photo.jpg$/)
  assert.throws(() => parseVariants({}, url), /Invalid product detail/)
  assert.throws(() => parseVariants({shohin_name: 'name'}, 'https://evil.invalid/'), /Unexpected/)
})
