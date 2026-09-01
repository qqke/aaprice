import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const ENDPOINT = "https://sundrug-online.com/products.json"
const STORE_ID = "sundrug-00000"
const PAGE_SIZE = 250
const BATCH_SIZE = 2
const BATCH_DELAY_MS = 1_100
const MAX_PAGE = 100
const MINIMUM_CATALOG_SIZE = 10_000

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

const barcodeOf = (variant, product) => {
  const candidates = [variant?.barcode, variant?.sku, product?.handle]
  return candidates.map(text).find((value) => /^\d{8,14}$/.test(value)) || ""
}

export function normalizeProduct(product) {
  const name = text(product?.title)
  const brand = text(product?.vendor)
  const category = text(product?.product_type)
  const imageUrl = text(product?.images?.[0]?.src)

  if (!name) return []

  return (product?.variants || []).flatMap((variant) => {
    const barcode = barcodeOf(variant, product)
    const priceYen = Number.parseInt(text(variant?.price).replaceAll(",", ""), 10)
    if (!barcode || !Number.isInteger(priceYen) || priceYen <= 0) return []

    const variantTitle = text(variant?.title)
    return [{
      barcode,
      name,
      brand,
      pack: variantTitle === "Default Title" ? "" : variantTitle,
      category,
      imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : "",
      priceYen,
      available: variant?.available !== false,
    }]
  })
}

export function csvCell(value) {
  const raw = value === true ? "true" : value === false ? "false" : String(value ?? "").replace(/[\r\n]+/g, " ")
  return `"${raw.replaceAll('"', '""')}"`
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function fetchPage(page) {
  const url = `${ENDPOINT}?limit=${PAGE_SIZE}&page=${page}`
  let lastError

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        error.retryAfter = Number(response.headers.get("retry-after")) || 0
        throw error
      }
      const payload = await response.json()
      if (!Array.isArray(payload?.products)) throw new Error("invalid product payload")
      return payload.products
    } catch (error) {
      lastError = error
      if (attempt < 6) {
        const retryAfterMs = (Number(error.retryAfter) || 0) * 1_000
        await wait(Math.max(retryAfterMs, attempt * 2_000))
      }
    }
  }

  throw new Error(`Sandrug page ${page} failed: ${lastError?.message || lastError}`)
}

export async function fetchCatalog() {
  const products = []
  let reachedSourceLimit = true

  for (let firstPage = 1; firstPage <= MAX_PAGE; firstPage += BATCH_SIZE) {
    const pages = await Promise.all(
      Array.from(
        { length: Math.min(BATCH_SIZE, MAX_PAGE - firstPage + 1) },
        (_, index) => fetchPage(firstPage + index),
      ),
    )
    const finalPage = pages.findIndex((page) => page.length < PAGE_SIZE)
    const includedPages = finalPage === -1 ? pages : pages.slice(0, finalPage + 1)
    products.push(...includedPages.flat())
    process.stdout.write(`\rFetched ${products.length.toLocaleString("en-US")} catalog products`)
    if (finalPage !== -1) {
      reachedSourceLimit = false
      break
    }
    await wait(BATCH_DELAY_MS)
  }

  process.stdout.write("\n")
  if (reachedSourceLimit) console.warn(`Sandrug source reached its ${MAX_PAGE * PAGE_SIZE} product pagination limit`)
  return products
}

function buildRows(products) {
  const rows = new Map()
  for (const product of products) {
    for (const row of normalizeProduct(product)) rows.set(row.barcode, row)
  }
  return [...rows.values()]
}

function databaseProcess(databaseUrl, input) {
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error("AAPRICE_DB_URL must be a valid PostgreSQL URL")
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("AAPRICE_DB_URL must use the postgresql protocol")
  }

  const args = [
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-h", parsed.hostname,
    "-p", parsed.port || "5432",
    "-U", decodeURIComponent(parsed.username),
    "-d", parsed.pathname.slice(1) || "postgres",
  ]
  const result = spawnSync("psql", args, {
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
    },
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `psql exited with ${result.status}`)
  return result.stdout.trim()
}

export function syncSql(rows) {
  const header = "barcode,name,brand,pack,category,image_url,price_yen,available"
  const csv = rows.map((row) => [
    row.barcode,
    row.name,
    row.brand,
    row.pack,
    row.category,
    row.imageUrl,
    row.priceYen,
    row.available,
  ].map(csvCell).join(",")).join("\n")

  return `\\set QUIET 1
begin;

do $$
begin
  if not exists (select 1 from public.stores where id = '${STORE_ID}') then
    raise exception 'Required store ${STORE_ID} does not exist';
  end if;
end
$$;

create temp table sundrug_sync_stage (
  barcode text primary key,
  name text not null,
  brand text not null,
  pack text not null,
  category text not null,
  image_url text not null,
  price_yen integer not null,
  available boolean not null
) on commit drop;

copy sundrug_sync_stage (barcode, name, brand, pack, category, image_url, price_yen, available)
from stdin with (format csv, header true);
${header}
${csv}
\\.

update public.products as product
set
  name = stage.name,
  brand = coalesce(nullif(stage.brand, ''), product.brand),
  pack = coalesce(nullif(stage.pack, ''), product.pack),
  category = coalesce(nullif(stage.category, ''), product.category),
  image_url = coalesce(nullif(stage.image_url, ''), product.image_url),
  catalog_source = 'sundrug',
  last_seen_at = now()
from sundrug_sync_stage as stage
where product.barcode = stage.barcode
  and (
    product.last_seen_at is null
    or product.last_seen_at < now() - interval '20 hours'
    or row(product.name, product.brand, product.pack, product.category, product.image_url, product.catalog_source) is distinct from row(
      stage.name,
      coalesce(nullif(stage.brand, ''), product.brand),
      coalesce(nullif(stage.pack, ''), product.pack),
      coalesce(nullif(stage.category, ''), product.category),
      coalesce(nullif(stage.image_url, ''), product.image_url),
      'sundrug'
    )
  );

insert into public.products (id, barcode, name, brand, pack, category, image_url, catalog_source, last_seen_at)
select barcode, barcode, name, brand, pack, category, image_url, 'sundrug', now()
from sundrug_sync_stage as stage
where not exists (
  select 1 from public.products as product where product.barcode = stage.barcode
);

with inserted as (
  insert into public.prices (product_id, store_id, price_yen, source, note, collected_at)
  select product.id, '${STORE_ID}', stage.price_yen, 'crawler', 'Sandrug Online Store sync', now()
  from sundrug_sync_stage as stage
  join public.products as product on product.barcode = stage.barcode
  where stage.available
    and not exists (
      select 1
      from public.prices as recent
      where recent.product_id = product.id
        and recent.store_id = '${STORE_ID}'
        and recent.source = 'crawler'
        and recent.price_yen = stage.price_yen
        and recent.collected_at >= now() - interval '20 hours'
    )
  returning 1
)
select
  (select count(*) from sundrug_sync_stage) as catalog_rows,
  (select count(*) from sundrug_sync_stage where available) as available_rows,
  (select count(*) from inserted) as price_snapshots_added;

select public.enqueue_price_alert_deliveries() as alerts_queued;

commit;
`
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const products = await fetchCatalog()
  const rows = buildRows(products)
  const availableRows = rows.filter((row) => row.available).length

  console.log(`Normalized ${rows.length.toLocaleString("en-US")} variants (${availableRows.toLocaleString("en-US")} available)`)
  if (rows.length < MINIMUM_CATALOG_SIZE) {
    throw new Error(`Catalog safety check failed: expected at least ${MINIMUM_CATALOG_SIZE.toLocaleString("en-US")} rows`)
  }
  if (dryRun) return

  const databaseUrl = process.env.AAPRICE_DB_URL
  if (!databaseUrl) throw new Error("AAPRICE_DB_URL is required unless --dry-run is used")
  console.log(databaseProcess(databaseUrl, syncSql(rows)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error)
    process.exitCode = 1
  })
}
