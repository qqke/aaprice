import test from 'node:test'
import assert from 'node:assert/strict'
import {parseUnicharmProduct} from '../scripts/crawl-unicharm-products.mjs'

test('Unicharm accepts only explicit child JAN and names, without parent metadata guesses', () => {
  const parsed = parseUnicharmProduct({id:'SB1010', name:'parent', image_url:'https://example.com/parent.jpg', children:[
    {jan:'4903111243921',name:'ムーニー ３０枚',image_url:'https://example.com/child.jpg'},
    {jan:'4903111123056',name:'ムーニー ５２枚'},
    {jan:'4903111243922',name:'bad check digit'},
    {jan:'4903111243921',name:''},
  ]}, 'SB1010')
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rejected.length, 2)
  assert.equal(parsed.rows[0].catalogSource, 'unicharm')
  assert.equal(parsed.rows[0].sourceUrl, 'https://map.unicharm.co.jp/?product=SB1010')
  assert.equal(parsed.rows[1].imageUrl, '')
  assert.throws(() => parseUnicharmProduct({id:'other',children:[]},'SB1010'))
})
