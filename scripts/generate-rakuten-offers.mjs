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

  return candidates.find((url) => new URL(url).pathname.includes(`/${productId}/`))
    ?? candidates.find((url) => new URL(url).searchParams.get("variantId") === productId)
    ?? null
}

const results = []
for (const productId of productIds) {
  try {
    const itemUrl = await findExactItem(productId)
    const result = itemUrl ? {
      product_id: productId,
      item_url: itemUrl,
      destination_url: `${affiliateBase}?pc=${encodeURIComponent(itemUrl)}&${linkOptions}`,
    } : { product_id: productId, error: "exact Rakuten item not found" }

    if (flags.has("--validate") && result.destination_url) {
      const redirect = await fetch(result.destination_url, { redirect: "manual" })
      result.tracking_valid = redirect.status >= 300
        && redirect.status < 400
        && redirect.headers.get("location")?.startsWith("https://pt.afl.rakuten.co.jp/c/")
    }
    results.push(result)
  } catch (error) {
    results.push({ product_id: productId, error: String(error?.message || error) })
  }
}

if (flags.has("--sql")) {
  if (results.some((result) => result.error || result.tracking_valid !== true)) {
    console.error(JSON.stringify(results.filter((result) => result.error || result.tracking_valid !== true), null, 2))
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
