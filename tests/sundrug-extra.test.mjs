import test from "node:test"
import assert from "node:assert/strict"
import { selectCollections, acceptProducts, sitemapProducts } from "../scripts/crawl-sundrug-extra.mjs"

test("selects public department collections and avoids previously crawled or nested departments",()=>{
  const all=[{handle:"daily",title:"日用品（全商品）",products_count:100},{handle:"otc",title:"医薬品（全商品）",products_count:20},{handle:"otc_001",title:"風邪薬（全商品）",products_count:5},{handle:"diy_top",title:"DIY（全商品）",products_count:200},{handle:"sale",title:"セール",products_count:10}]
  assert.deepEqual(selectCollections(all).map(c=>c.handle),["daily","otc"])
  assert.throws(()=>selectCollections(null),/Invalid/)
})

test("sitemap identity requires a valid JAN matching its official image filename",()=>{
  const entry=(barcode,image,title)=>`<url><loc>https://sundrug-online.com/products/${barcode}</loc><image:image><image:loc>https://cdn.shopify.com/files/${image}.jpg?v=1&amp;width=100</image:loc><image:title>${title}</image:title></image:image></url>`
  const parsed=sitemapProducts(entry("4987176356284","4987176356284_01","P&amp;G 商品"))
  assert.equal(parsed[0].name,"P&G 商品");assert.equal(parsed[0].evidenceType,"official-product-sitemap");assert.equal(parsed[0].brand,"")
  assert.equal(sitemapProducts(entry("4987176356284","generic","商品")).length,0)
  assert.equal(sitemapProducts(entry("4987176356285","4987176356285","商品")).length,0)
})

test("accepts only validated new JANs and tracks resolved product handles",()=>{
  const p={handle:"4987176356284",title:"商品",variants:[{sku:"4987176356284"}]}, rows=new Map(), handles=new Set()
  acceptProducts([p,p],new Set(),rows,handles)
  assert.equal(rows.size,1);assert.equal(handles.size,1)
  assert.equal(rows.get(p.handle).catalogSource,"sundrug")
  const missing=new Set();acceptProducts([{handle:"bundle",title:"セット",variants:[]}],new Set(),rows,handles,missing);assert.equal(missing.size,1)
  const existing=new Map();acceptProducts([p],new Set([p.handle]),existing,handles);assert.equal(existing.size,0)
  assert.throws(()=>acceptProducts([{}],new Set(),rows,handles),/Invalid product/)
})
