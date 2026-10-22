import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {validJan} from './crawl-drugstores.mjs'
import {createFetcher} from './crawl-national-stores.mjs'

export const sitemapUrl = 'https://www.shiseido.co.jp/sw/onlinestore/sitemap_item_dtl.xml'
const productUrl = /^https:\/\/www\.shiseido\.co\.jp\/sw\/onlinestore\/products\/[A-Za-z0-9]+\.html$/
const text = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''

export function parseShiseidoSitemap(xml) {
  const urls = [...new Set([...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match => match[1].trim()))]
  assert(urls.length && urls.every(url => productUrl.test(url)), 'Empty or unexpected Shiseido product sitemap')
  return urls
}

export function parseShiseidoProduct(html, sourceUrl) {
  assert(productUrl.test(sourceUrl), 'Unexpected Shiseido product URL')
  const objects = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(match => {const value = JSON.parse(match[1]); return Array.isArray(value) ? value : value['@graph'] || [value]})
  const product = objects.find(value => value['@type'] === 'Product')
  const barcode = text(product?.sku), name = text(product?.name)
  assert(name && validJan(barcode), 'Missing Product name or invalid JAN')
  const breadcrumb = objects.find(value => value['@type'] === 'BreadcrumbList')
  return {barcode, name, brand: text(product.brand?.name), pack: '',
    category: text(breadcrumb?.itemListElement?.at(-2)?.name), description: text(product.description),
    imageUrl: /^https:\/\//.test(product.image || '') ? product.image : '', catalogSource: 'shiseido', sourceUrl}
}

async function main() {
  const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || 'artifacts/products-2026-10-22'
  const get = await createFetcher(`${out}/shiseido-cache`, process.argv.includes('--offline'), process.argv.includes('--resume'))
  const sitemap = await get(sitemapUrl), urls = parseShiseidoSitemap(sitemap.html), rows = new Map(), failures = []
  // shortcut: sitemap covers representative products, add a verified variant source to enumerate unlisted shades/sizes.
  for (let offset = 0; offset < urls.length; offset += 4) {
    const results = await Promise.allSettled(urls.slice(offset, offset + 4).map(async url => {
      const saved = await get(url)
      return parseShiseidoProduct(saved.html, url)
    }))
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {if (!rows.has(result.value.barcode)) rows.set(result.value.barcode, result.value)}
      else failures.push({url: urls[offset + index], reason: result.reason.message})
    }
    console.log(`Shiseido ${Math.min(offset + 4, urls.length)}/${urls.length}: ${rows.size} unique products, ${failures.length} rejected`)
    await writeFile(`${out}/shiseido.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/shiseido-report.json`, JSON.stringify({sourceUrl: sitemapUrl, collectedAt: sitemap.collectedAt,
      discovered: urls.length, attempted: Math.min(offset + 4, urls.length), accepted: rows.size, failures,
      enumerationComplete: offset + 4 >= urls.length, databaseApplied: false}, null, 2))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
