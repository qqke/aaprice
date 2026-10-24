import { decodeRakutenHtml, isPurchasableRakutenItem } from "./lib/rakuten-items.mjs"

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")))
const productIds = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))

if (!productIds.length) {
  console.error("Usage: node scripts/generate-rakuten-offers.mjs [--validate] [--sql] <JAN> [...JAN]")
  process.exit(1)
}

const affiliateBase = "https://hb.afl.rakuten.co.jp/ichiba/5703cea2.c30faf5e.5703cea3.22c9e6ff/"
const linkOptions = "link_type=hybrid_url&ut=eyJwYWdlIjoiaXRlbSIsInR5cGUiOiJoeWJyaWRfdXJsIiwic2l6ZSI6IjI0MHgyNDAiLCJuYW0iOjEsIm5hbXAiOiJyaWdodCIsImNvbSI6MSwiY29tcCI6ImRvd24iLCJwcmljZSI6MSwiYm9yIjoxLCJjb2wiOjEsImJidG4iOjEsInByb2QiOjAsImFtcCI6ZmFsc2V9"

function decodeMarkup(value) {
  return value
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&")
}

async function findExactItem(productId) {
  const response = await fetch(`https://search.rakuten.co.jp/search/mall/${productId}/`)
  if (!response.ok) throw new Error(`Rakuten search returned ${response.status}`)

  const html = decodeMarkup(await response.text())
  const candidates = [...html.matchAll(/https:\/\/item\.rakuten\.co\.jp\/[^\s"'<>\\]+/g)]
    .map((match) => match[0])
    .filter((url) => url.includes(productId))
    .map((url) => url.replace(/[?&](scid|iasid|icm_acid|icm_cid|icm_agid)=[^&]*/g, ""))

  const exact = [...new Set(candidates)].filter((value) => {
    const url = new URL(value)
    return url.pathname.includes(`/${productId}/`) || url.searchParams.get("variantId") === productId
  }).slice(0, 10)
  for (const url of exact) {
    try {
      const item = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!item.ok) continue
      const html = decodeRakutenHtml(new Uint8Array(await item.arrayBuffer()), item.headers.get("content-type") || "")
      if (isPurchasableRakutenItem(html, productId)) return url
    } catch { /* Leave unsupported or unavailable items for manual review. */ }
  }
  return null
}

const results = []
for (const productId of productIds) {
  try {
    const itemUrl = await findExactItem(productId)
    const result = itemUrl ? {
      product_id: productId,
      item_url: itemUrl,
      destination_url: `${affiliateBase}?pc=${encodeURIComponent(itemUrl)}&${linkOptions}`,
    } : { product_id: productId, error: "exact purchasable Rakuten item not found; manual review required" }

    if (flags.has("--validate") && result.destination_url) {
      result.item_verified = true
    }
    results.push(result)
  } catch (error) {
    results.push({ product_id: productId, error: String(error?.message || error) })
  }
}

if (flags.has("--sql")) {
  if (results.some((result) => result.error || result.item_verified !== true)) {
    console.error(JSON.stringify(results.filter((result) => result.error || result.item_verified !== true), null, 2))
    process.exit(1)
  }

  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
  const values = results.map((result) => `(${quote(result.product_id)}, 'rakuten', 'rakuten-mvp-2026-09', ${quote(result.destination_url)}, true)`).join(",\n")
  console.log(`begin;
insert into public.commercial_offers (product_id, partner, campaign, destination_url, is_active)
values
${values}
on conflict (product_id, partner) do update set
  campaign = excluded.campaign,
  destination_url = excluded.destination_url,
  is_active = excluded.is_active;
commit;`)
} else {
  console.log(JSON.stringify(results, null, 2))
}
