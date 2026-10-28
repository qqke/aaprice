import assert from 'node:assert/strict'
import {parseOhmProduct,ohmLinks,parseOhmList} from './crawl-ohm-products.mjs'
const url='https://www.ohm-direct.com/shopdetail/000000031921/'
const sample='<p id="item" class="clearfix">モール DZ-AMD1-ML</p><div id="itemImgBox"><a><img src="https://makeshop-multi-images.akamaized.net/ohmelectric/itemimages/0000000319212_main.jpg"></a></div><div id="itemInfo"><p>[商品名] モール DZ-AMD1-ML</p><p>[JAN]4971275927551<br>[型番] DZ-AMD1-ML</p><p id="price">'
assert.equal(parseOhmProduct(sample,url).barcode,'4971275927551')
assert.equal(parseOhmProduct(sample.replace('<a><img src="https://makeshop-multi-images.akamaized.net/ohmelectric/itemimages/0000000319212_main.jpg">','<div class="M_imageWrap"><div class="M_imageMain"><a><img src="https://makeshop-multi-images.akamaized.net/ohmelectric/shopimages/21/19/1_000000031921.jpg?123">'),url).barcode,'4971275927551')
const gallerySample=sample.replace('itemimages/0000000319212_main.jpg','shopimages/21/19/19_000000031921.jpg')
assert.equal(parseOhmProduct(gallerySample,url).barcode,'4971275927551')
assert.equal(parseOhmProduct(gallerySample.replace('19_000000031921','19_000000031922'),url).reason,'Missing or mismatched main product image')
assert.equal(parseOhmProduct(sample.replace('<div id="itemImgBox">','<div id="recommendations">')+'<img src="https://makeshop-multi-images.akamaized.net/ohmelectric/shopimages/21/19/19_000000031921.jpg">',url).reason,'Missing or mismatched main product image')
assert.equal(parseOhmProduct(sample.replace('[JAN]','[商品番号]'),url).reason,'Missing ambiguous or invalid explicit JAN')
assert.equal(parseOhmProduct(sample.replace('4971275927551','4971275927552'),url).reason,'Missing ambiguous or invalid explicit JAN')
assert.equal(parseOhmProduct(sample,url.replace('31921','99999')).reason,'Missing or mismatched main product image')
assert.equal(parseOhmProduct(sample.replace('0000000319212_main','00000003192129_main'),url).reason,'Missing or mismatched main product image')
assert.equal(parseOhmProduct(sample.replace('/ohmelectric/','/otherstore/'),url).reason,'Missing or mismatched main product image')
assert.equal(parseOhmProduct(sample.replace('<p>[商品名] モール','<p>[商品名] 別商品'),url).reason,'Missing or mismatched main product name')
assert.equal(parseOhmProduct(sample.replace('[型番] DZ-AMD1-ML','[型番] OTHER'),url).reason,'Missing or mismatched explicit model')
assert.equal(parseOhmProduct(sample.replace('[JAN]4971275927551','[JAN]4971275927551 [JAN]4971275172470'),url).reason,'Missing ambiguous or invalid explicit JAN')
assert.equal(parseOhmProduct(sample.replace('https://makeshop-multi-images.akamaized.net','https://evil.test'),url).reason,'Missing or mismatched main product image')
assert.deepEqual(ohmLinks('<a href="/shopdetail/0001/ct653/page1/recommend/"><a href="https://evil.test/shopdetail/0002/">'),['https://www.ohm-direct.com/shopdetail/0001/'])
assert.deepEqual(parseOhmList('<p class="total">全1件</p><div class="section" id="r_categoryList"><a href="/shopdetail/0001/"><ul class="M_pager">'),{total:1,urls:['https://www.ohm-direct.com/shopdetail/0001/']})
assert.throws(()=>parseOhmList('<p>maintenance</p>'),/Missing public listing/)
console.log('Ohm main JAN/name/model/image identity and origin checks passed')
