import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { csvCell, databaseProcess } from "./sync-sundrug.mjs"

const origins = {
  sundrug: "https://sundrug-online.com",
  matsukiyo: "https://www.matsukiyococokara-online.com",
  kao: "https://www.kao-kirei.com",
  shiseido: "https://www.shiseido.co.jp",
  sugi: "https://sugi-drug.com",
  qols: "https://qol-shop.jp",
  lion: "https://map.lion.co.jp",
  kirindo: "https://www.kirindo-shop.com",
  welcia: "https://www.e-welcia.com",
  unicharm: "https://map.unicharm.co.jp",
  tsuruha: "https://shop.tsuruha.co.jp",
  earth: "https://www.earth.jp",
  tomods: "https://tomods-ap.com",
  create: "https://netshop.create-sd.co.jp",
  kyorindo: "https://www.kyorindo-onlineshop.jp",
  doramori: "https://net-shop.doramori.co.jp",
  seims: "https://www.seims.co.jp",
  kai: "https://store.kai-group.com",
  elpa: "https://www.elpadirect.jp",
}

export function validGtin(value) {
  if (typeof value !== "string" || !/^(?:\d{8}|\d{12,14})$/.test(value)) return false
  const digits = [...value].map(Number), check = digits.pop()
  return (10 - digits.reverse().reduce((sum, digit, i) => sum + digit * (i % 2 ? 1 : 3), 0) % 10) % 10 === check
}

export function prepareRows(products) {
  const unique = new Map(), excluded = []
  for (const product of products) {
    try {
      if (!validGtin(product.barcode)) throw Error("Invalid GTIN/check digit")
      const identity = product.barcode.padStart(14, "0"), prefix = identity.slice(1)
      // GS1 RCN-8 (0/2) and prefixes 020–029, 040–049, 200–299 are restricted circulation.
      if (/^(?:02|04|2)/.test(prefix) || /^0{5}[02]\d{7}$/.test(prefix)) throw Error("Restricted circulation code")
      if (typeof product.name !== "string" || !product.name.trim()) throw Error("Missing product name")
      if (!origins[product.catalogSource] || new URL(product.sourceUrl).origin !== origins[product.catalogSource]) throw Error("Unverified source URL")
      const row = { barcode: product.barcode, catalogSource: product.catalogSource, sourceUrl: product.sourceUrl }
      for (const key of ["name", "brand", "pack", "category", "description", "imageUrl"]) {
        if (product[key] != null && typeof product[key] !== "string") throw Error(`Invalid ${key}`)
        row[key] = (product[key] || "").replace(/\s+/g, " ").trim()
      }
      if (row.imageUrl && !/^https?:\/\//.test(row.imageUrl)) throw Error("Invalid image URL")
      if (!unique.has(identity)) unique.set(identity, row)
    } catch (error) {
      excluded.push({ barcode: product?.barcode, sourceUrl: product?.sourceUrl, reason: error.message })
    }
  }
  return { rows: [...unique.values()], excluded, duplicates: products.length - unique.size - excluded.length }
}

export function insertSql(rows) {
  const csv = rows.map(row => [row.barcode, row.name, row.brand, row.pack, row.category, row.description, row.imageUrl, row.catalogSource].map(csvCell).join(",")).join("\n")
  return `\\set QUIET 1
\\pset tuples_only on
\\pset format unaligned
begin;
set local lock_timeout = '15s';
set local statement_timeout = '120s';
create temp table new_product_stage (barcode text primary key, name text, brand text, pack text, category text, description text, image_url text, catalog_source text) on commit drop;
copy new_product_stage from stdin with (format csv);
${csv}
\\.
lock table public.products in share row exclusive mode;
create temp table products_before on commit drop as select id, md5(to_jsonb(p)::text) as fingerprint from public.products p;
create temp table products_inserted on commit drop as
with inserted as (
  insert into public.products (id, barcode, name, brand, pack, category, description, image_url, catalog_source, last_seen_at)
  select s.barcode, s.barcode, s.name, s.brand, s.pack, s.category, s.description, s.image_url, s.catalog_source, now()
  from new_product_stage s
  where not exists (select 1 from public.products p where p.barcode = s.barcode or p.id = s.barcode)
    and not exists (
      select 1 from public.products p
      where p.barcode ~ '^([0-9]{8}|[0-9]{12,14})$'
        and lpad(p.barcode, 14, '0') = lpad(s.barcode, 14, '0')
    )
  on conflict do nothing
  returning id, barcode, catalog_source
) select * from inserted;
do $$ begin
  if exists (select 1 from products_before b left join public.products p on p.id=b.id where p.id is null or md5(to_jsonb(p)::text) <> b.fingerprint) then
    raise exception 'Existing products changed; rolling back import';
  end if;
end $$;
select json_build_object(
  'before', (select count(*) from products_before),
  'candidates', (select count(*) from new_product_stage),
  'inserted', (select count(*) from products_inserted),
  'skippedExisting', (select count(*) from new_product_stage) - (select count(*) from products_inserted),
  'after', (select count(*) from public.products),
  'existingUnchanged', true,
  'bySource', (select coalesce(json_object_agg(catalog_source, n), '{}'::json) from (select catalog_source, count(*) n from products_inserted group by catalog_source) s)
);
commit;
`
}

async function main() {
  const files = process.argv.slice(2).filter(arg => !arg.startsWith("--"))
  if (!files.length) throw Error("Pass product JSON files; add --apply to insert new products")
  const out = process.argv.find(arg => arg.startsWith("--out="))?.slice(6) || "artifacts/products-2026-10-22"
  const products = (await Promise.all(files.map(async file => {
    const data = JSON.parse(await readFile(file, "utf8"))
    if (!Array.isArray(data)) throw Error(`Expected product array: ${file}`)
    return data
  }))).flat()
  const { rows, excluded, duplicates } = prepareRows(products)
  if (!rows.length) throw Error("No valid products to import")
  await mkdir(out, { recursive: true })
  await writeFile(`${out}/import.sql`, insertSql(rows))
  const report = { generatedAt: new Date().toISOString(), files, candidates: rows.length, duplicates, excluded, applied: false }
  if (process.argv.includes("--apply")) {
    if (!process.env.AAPRICE_DB_URL) throw Error("AAPRICE_DB_URL is required for --apply")
    const output = databaseProcess(process.env.AAPRICE_DB_URL, insertSql(rows))
    report.database = JSON.parse(output)
    report.applied = true
  }
  await writeFile(`${out}/import-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, excluded: excluded.length }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
