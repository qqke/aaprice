import fs from 'node:fs/promises'
import { createFetcher } from './crawl-national-stores.mjs'
const out = 'artifacts/drugstores-mori-2026-09-13'
const get = await createFetcher(out, process.argv.includes('--offline'), process.argv.includes('--resume'))
const page = await get('https://www.doramori.co.jp/store/')
const urls = [...new Set([...page.html.matchAll(/<h4 class="name">\s*<a href="([^"]+)"/g)].map(m => m[1]))]
if (!urls.length) throw Error('No official store detail links')
await fs.writeFile(`${out}/index-urls.json`, JSON.stringify(urls, null, 2))
await fs.writeFile(`${out}/report.json`, JSON.stringify({ source: 'drugstore-mori', sourceUrl: page.url, collectedAt: page.collectedAt, discoveredDetailUrls: urls.length, status: 'See report-details.json for detail collection results' }, null, 2))
console.log(JSON.stringify({ discoveredDetailUrls: urls.length }))
