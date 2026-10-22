import { readFile, writeFile, readdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { catalogRows, validBarcode } from "./crawl-sundrug-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"

const origin = "https://sundrug-online.com"
const decodeXml = value => value.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")

export function sitemapProducts(xml) {
  return [...xml.matchAll(/<url>\s*([\s\S]*?)<\/url>/g)].flatMap(([, block]) => {
    const sourceUrl = decodeXml(block.match(/<loc>([^<]+)<\/loc>/)?.[1] || "")
    const barcode = sourceUrl.match(/^https:\/\/sundrug-online\.com\/products\/(\d+)$/)?.[1] || ""
    const name = decodeXml(block.match(/<image:title>([^<]+)<\/image:title>/)?.[1] || "").replace(/\s+/g, " ").trim()
    const imageUrl = decodeXml(block.match(/<image:loc>([^<]+)<\/image:loc>/)?.[1] || "")
    if (!validBarcode(barcode) || !name || name === barcode || !/^https:\/\/cdn\.shopify\.com\//.test(imageUrl)) return []
    if (!new RegExp(`(?:^|[^0-9])${barcode}(?:[^0-9]|$)`).test(new URL(imageUrl).pathname.split("/").at(-1))) return []
    // shortcut: sitemap identities lack verified brand/pack/category; use product details when those fields are needed.
    return [{barcode,name,brand:"",pack:"",category:"",description:"",imageUrl,catalogSource:"sundrug",sourceUrl,evidenceType:"official-product-sitemap"}]
  })
}

export function selectCollections(collections) {
  if (!Array.isArray(collections)) throw Error("Invalid collections payload")
  return collections.filter(c => /全商品/.test(c.title) && !c.handle.startsWith("otc_") && c.handle !== "diy_top")
    .sort((a, b) => b.products_count - a.products_count)
}

export function acceptProducts(products, existing, rows, handles, missingGtin = new Set()) {
  if (!Array.isArray(products)) throw Error("Invalid products payload")
  for (const product of products) {
    if (typeof product.handle !== "string" || !Array.isArray(product.variants)) throw Error("Invalid product")
    const url = `${origin}/products/${encodeURIComponent(product.handle)}`
    handles.add(url)
    const normalized = catalogRows(product, url)
    if (!normalized.length) missingGtin.add(url)
    for (const row of normalized) if (!existing.has(row.barcode) && !rows.has(row.barcode)) rows.set(row.barcode, row)
  }
}

async function main() {
  const out = "artifacts/products-round2-2026-10-22"
  const get = await createFetcher(`${out}/sundrug-cache`, process.argv.includes("--offline"), true)
  const snapshot = databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(barcode) from public.products;")
  const existing = new Set(JSON.parse(snapshot)), rows = new Map(), handles = new Set(), missingGtin = new Set(), coverage = [], failures = []
  const originalPending = JSON.parse(await readFile("artifacts/products-2026-10-22/sundrug-pending-urls.json", "utf8"))
  const unknown = originalPending.filter(url => !existing.has(decodeURIComponent(new URL(url).pathname.split("/").at(-1))))
  let blocked = false, attemptedDetails = 0, collectionsEnumerated = false, sitemapAdded = 0, sitemapValidation = []
  async function save() {
    const remaining = unknown.filter(url => !handles.has(url) && !rows.has(decodeURIComponent(new URL(url).pathname.split("/").at(-1))))
    await writeFile(`${out}/sundrug.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/sundrug-pending-urls.json`, JSON.stringify(remaining, null, 2))
    await writeFile(`${out}/sundrug-report.json`, JSON.stringify({generatedAt:new Date().toISOString(), existingAtStart:existing.size, originalPending:originalPending.length, initiallyUnknown:unknown.length, collectionsEnumerated, coverage, newProducts:rows.size, attemptedDetails, sitemapAdded, sitemapValidation, remaining:remaining.length, missingGtinProducts:missingGtin.size, missingGtinUrls:[...missingGtin], blocked, pendingPassComplete:remaining.length===0 && !blocked, completeScope:"Starting pending product URL list; not a claim of full-store coverage", failures}, null, 2))
  }
  async function request(url) {
    if (blocked) throw Error("Stopped after rate limit")
    try { return JSON.parse((await get(url)).html) }
    catch (error) {if (/429/.test(error.message)) blocked = true; throw error}
  }
  try {
    const all = []
    for (let page=1;page<=15;page++) {
      const payload=await request(`${origin}/collections.json?limit=250&page=${page}`)
      if(!Array.isArray(payload.collections)) throw Error("Invalid collections payload")
      all.push(...payload.collections)
      if(payload.collections.length<250){collectionsEnumerated=true;break}
    }
    if(!collectionsEnumerated) throw Error("Collection directory pagination limit reached")
    const queue=selectCollections(all)
    let next=0
    await Promise.all(Array.from({length:2},async()=>{
      while(next<queue.length&&!blocked){
        const collection=queue[next++], progress={handle:collection.handle,listed:collection.products_count,pages:0,products:0,reachedEnd:false}
        coverage.push(progress)
        for(let page=1;page<=100&&!blocked;page++){
          const url=`${origin}/collections/${encodeURIComponent(collection.handle)}/products.json?limit=250&page=${page}`
          try{
            const payload=await request(url)
            acceptProducts(payload.products,existing,rows,handles,missingGtin)
            progress.pages++;progress.products+=payload.products.length
            if(payload.products.length<250){progress.reachedEnd=true;break}
            if(page%10===0){console.log(`${collection.handle} ${page} pages; ${rows.size} new products`);await save()}
          }catch(error){failures.push({url,reason:error.message});break}
        }
        progress.difference=progress.listed-progress.products
        await save()
      }
    }))
    const sitemapRows=new Map(), cachedDetails=[]
    const oldCache="artifacts/products-2026-10-22/sundrug-cache"
    for(const file of await readdir(oldCache)){
      const text=await readFile(`${oldCache}/${file}`,"utf8")
      if(text.includes("<image:title>"))for(const row of sitemapProducts(text))sitemapRows.set(row.barcode,row)
      else if(text.startsWith('{"product":')){try{cachedDetails.push(JSON.parse(text).product)}catch{}}
    }
    for(const product of cachedDetails){
      const row=sitemapRows.get(product.handle)
      if(!row)continue
      const detailName=String(product.title||"").replace(/\s+/g," ").trim()
      sitemapValidation.push({barcode:row.barcode,sitemapName:row.name,detailName,matches:row.name===detailName})
      if(sitemapValidation.length===10)break
    }
    if(sitemapValidation.length<10||sitemapValidation.some(sample=>!sample.matches))throw Error("Sitemap title validation against 10 cached product details failed")
    for(const row of sitemapRows.values())if(!existing.has(row.barcode)&&!rows.has(row.barcode)){rows.set(row.barcode,row);sitemapAdded++}
    await save()
    const pending=unknown.filter(url=>!handles.has(url)&&!rows.has(decodeURIComponent(new URL(url).pathname.split("/").at(-1))))
    console.log(`Collections yielded ${rows.size} new products; ${pending.length} pending details`)
    // Single sequential detail requests keep this final pass below the source's observed rate limit.
    for(const url of pending){
      if(blocked)break
      try{
        const payload=await request(`${url}.json`)
        if(!payload.product)throw Error("Invalid product detail")
        acceptProducts([payload.product],existing,rows,handles,missingGtin)
      }catch(error){failures.push({url,reason:error.message})}
      attemptedDetails++
      if(attemptedDetails%50===0){console.log(`Details ${attemptedDetails}/${pending.length}; ${rows.size} new products`);await save()}
    }
  }catch(error){failures.push({reason:error.message})}
  finally{await save()}
  console.log(JSON.stringify({newProducts:rows.size,attemptedDetails,blocked,failures:failures.length}))
  if(blocked||failures.length)process.exitCode=1
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1})
