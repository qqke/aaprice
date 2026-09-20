import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { databaseProcess } from "./sync-sundrug.mjs"

export const sources = {
  tsuruha: { name: "ツルハグループ e-shop（オンライン）", base: "https://shop.tsuruha.co.jp" },
  welcia: { name: "ウエルシアドットコム（オンライン）", base: "https://www.e-welcia.com" },
  matsukiyo: { name: "マツキヨココカラ（オンライン）", base: "https://www.matsukiyococokara-online.com" },
  ainz: { name: "アインズ＆トルペ（オンライン）", base: "https://ainz-tulpe.jp" },
  kirindo: { name: "キリン堂通販（オンライン）", base: "https://www.kirindo-shop.com" },
  tomods: { name: "Tomod's ONLINE SHOP（オンライン）", base: "https://tomods-ap.com" },
  kokumin: { name: "コクミンドラッグ ネットショップ（オンライン）", base: "https://e-shop.kokumin.co.jp" },
  create: { name: "クリエイトSDネットショップ（オンライン）", base: "https://netshop.create-sd.co.jp" },
  kyorindo: { name: "杏林堂オンラインショップ（オンライン）", base: "https://www.kyorindo-onlineshop.jp" },
  doramori: { name: "ドラッグストアモリ ネットショップ（オンライン）", base: "https://net-shop.doramori.co.jp" },
  sugi: { name: "スギ薬局 Beauty Store（オンライン）", base: "https://sugi-drug.com" },
  seims: { name: "ドラッグセイムス公式通販（オンライン）", base: "https://www.seims.co.jp" },
  qols: { name: "クオール薬局公式オンラインストア（オンライン）", base: "https://qol-shop.jp" },
}
// Sundrug is intentionally absent: its catalog sync is paused by request.
const decode = (s = "") => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const plain = (s = "") => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
const match = (html, pattern) => html.match(pattern)?.[1] || ""
const meta = (html, property) => decode(match(html, new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]+)"`, "i")))
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]))
const links = (html, base) => [...new Set([...html.matchAll(/href=["']([^"']+)["']/g)].flatMap((m) => {
  try { const u = new URL(decode(m[1]), base); return u.origin === new URL(base).origin ? [u.href] : [] } catch { return [] }
}))]

export function validJan(value) {
  if (!/^(?:\d{8}|\d{13})$/.test(value)) return false
  const digits = [...value].map(Number)
  const check = digits.pop()
  return (10 - digits.reverse().reduce((sum, n, i) => sum + n * (i % 2 ? 1 : 3), 0) % 10) % 10 === check
}

export function robotsAllow(robots, url) {
  let universal = false
  const rules = []
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const separator = line.indexOf(":")
    if (separator < 0) continue
    const key = line.slice(0, separator).toLowerCase(), value = line.slice(separator + 1).trim()
    if (key === "user-agent") universal = value === "*" || value.toLowerCase() === "aapricecatalog"
    else if (universal && ["allow", "disallow"].includes(key) && value) {
      const pattern = value.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")
      if (new RegExp(`^${pattern}`).test(new URL(url).pathname + new URL(url).search)) rules.push({ allow: key === "allow", length: value.length })
    }
  }
  rules.sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow))
  return rules[0]?.allow ?? true
}

export function parseProduct(source, html, url, collectedAt = new Date().toISOString()) {
  if (!sources[source] || new URL(url).origin !== sources[source].base) throw new Error("Unexpected source URL")
  let name, barcode, price, available, imageUrl, brand = ""
  if (source === "tsuruha") {
    name = plain(match(html, /<span[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/span>/))
    barcode = plain(match(html, /商品番号\(JANコード\)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/))
    price = match(html, /<meta\s+itemprop="price"\s+content="([^"]+)"/)
    available = /class="stock available"/.test(html)
    imageUrl = meta(html, "og:image")
    if (!/（税込）/.test(html)) throw new Error("Tax basis unconfirmed")
  } else if (source === "welcia") {
    name = plain(match(html, /<h1 class="p-product-main__name">([\s\S]*?)<\/h1>/))
    barcode = match(html, /JANコード[：:]\s*(\d+)/)
    price = plain(match(html, /<p class="p-product-setting-price__tax">([\s\S]*?)<\/p>/)).match(/税込:\s*([\d,.]+)円/)?.[1]
    const buyButton = match(html, /(<button\b[^>]*onclick=['"]submitAddCartForm\(\)['"][^>]*>)/)
    available = /<form[^>]+action="https:\/\/www\.e-welcia\.com\/product\/add_cart\/\d+"/.test(html)
      && Boolean(buyButton) && !/\bdisabled\b/i.test(buyButton)
    imageUrl = meta(html, "og:image")
  } else if (source === "ainz") {
    const data = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : [o] } catch { return [] } })
    const p = data.find((o) => o?.["@type"] === "Product")
    name = plain(p?.name || "")
    barcode = (html.match(/(?:JAN|ＪＡＮ)[\s\S]{0,500}?\b(\d{13})\b/i) || [])[1] || ""
    price = String(p?.offers?.price || "")
    available = /InStock/i.test(JSON.stringify(p?.offers || {}))
    imageUrl = typeof p?.image === "string" ? p.image : ""
    brand = plain(p?.brand?.name || "")
  } else if (source === "kirindo") {
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""
    name = plain(title).replace(/\s*[｜|].*$/, "")
    barcode = new URL(url).pathname.match(/(\d{13})$/)?.[1] || ""
    price = (html.match(/(?:税込|販売価格)[^\d]{0,40}([\d,]+)\s*円/i) || [])[1] || ""
    available = !/在庫切れ|販売終了|取り寄せ/i.test(html)
  } else if (source === "tomods") {
    name = plain(match(html, /<title>([\s\S]*?)<\/title>/i)).replace(/\s*[｜|].*$/, "")
    barcode = new URL(url).pathname.match(/g(\d{13})\/?$/)?.[1] || ""
    price = (html.match(/￥\s*([\d,]+)/i) || html.match(/(?:税込|販売価格)[^\d]{0,50}([\d,]+)\s*円/i) || [])[1] || ""
    available = /カートに入れる/.test(html) && !/在庫切れ|販売終了/i.test(html)
  } else if (source === "kokumin") {
    name = plain(match(html, /<title>([\s\S]*?)<\/title>/i)).replace(/\s*[｜|].*$/, "")
    barcode = (html.match(/\b(\d{13})\b/) || [])[1] || ""
    price = (html.match(/item-info-price[^>]*>\s*([\d,]+)円\s*（税込）/i) || [])[1] || ""
    available = !/在庫切れ|販売終了/i.test(html)
  } else if (source === "create") {
    name = plain(match(html, /<title>([\s\S]*?)<\/title>/i)).replace(/\s*[｜|].*$/, "")
    barcode = new URL(url).pathname.match(/g(\d{13})\/?$/)?.[1] || ""
    price = (html.match(/saleprice_[\s\S]{0,500}?<p>[\s\S]*?([\d,]+)\s*<span/i) || html.match(/(?:税込価格|税込)[^\d]{0,40}([\d,]+)円/i) || [])[1] || ""
    available = /カート|買い物かご/.test(html) && !/販売終了|在庫切れ/i.test(html)
  } else if (source === "kyorindo") {
    const data = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : [o] } catch { return [] } })
    const p = data.find((o) => o?.["@type"] === "Product")
    name = plain(p?.name || "")
    barcode = new URL(url).pathname.match(/g(\d{13})\/?$/)?.[1] || p?.mpn || ""
    price = String(p?.offers?.price || "")
    available = /InStock/i.test(JSON.stringify(p?.offers || {}))
  } else if (source === "doramori") {
    name = plain(match(html, /<title>([\s\S]*?)<\/title>/i)).replace(/\s*[｜|].*$/, "")
    barcode = (html.match(/\b(\d{13})\b/) || [])[1] || ""
    price = (html.match(/(?:税込|販売価格)[^\d]{0,50}([\d,]+)\s*円/i) || html.match(/￥\s*([\d,]+)/i) || [])[1] || ""
    available = !/在庫切れ|販売終了/i.test(html)
  } else if (source === "sugi") {
    const data = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : [o] } catch { return [] } })
    const p = data.find((o) => o?.["@type"] === "Product")
    name = plain(p?.name || "")
    const offer = Array.isArray(p?.offers) ? p.offers[0] : p?.offers
    barcode = p?.sku || offer?.sku || (html.match(/\b(\d{13})\b/) || [])[1] || ""
    price = String(offer?.price || "")
    available = /InStock/i.test(JSON.stringify(offer || {}))
  } else if (source === "seims") {
    const data = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : [o] } catch { return [] } })
    const p = data.find((o) => o?.["@type"] === "Product")
    name = plain(p?.name || plain(match(html, /<title>([\s\S]*?)<\/title>/i)).replace(/\s*[｜|].*$/, ""))
    barcode = new URL(url).pathname.match(/g(\d{13})\/?$/)?.[1] || p?.sku || ""
    const offer = Array.isArray(p?.offers) ? p.offers[0] : p?.offers
    price = String(offer?.price || "")
    available = /InStock/i.test(JSON.stringify(offer || {})) || /カートに入れる/.test(html)
    imageUrl = typeof p?.image === "string" ? p.image : ""
    brand = plain(p?.brand?.name || "")
  } else if (source === "qols") {
    const data = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : [o] } catch { return [] } })
    const p = data.find((o) => o?.["@type"] === "Product")
    name = plain(p?.name || "")
    barcode = String(p?.gtin13 || p?.gtin || p?.productId || "")
    price = String(p?.offers?.price || "")
    available = /InStock/i.test(JSON.stringify(p?.offers || {}))
    imageUrl = typeof p?.image === "string" ? p.image : ""
    brand = plain(p?.brand?.name || "")
  } else {
    const objects = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : o["@graph"] || [o] } catch { return [] } })
    const p = objects.find((o) => o?.["@type"] === "Product")
    if (!p || p.offers?.priceCurrency !== "JPY" || Array.isArray(p.offers)) throw new Error("Missing unambiguous JPY Product offer")
    name = plain(p.name)
    barcode = match(html, /<big>JANコード<\/big>[\s\S]*?<dd>\s*<big>(\d+)<\/big>/)
    if (new URL(url).pathname.split("/").at(-1) !== barcode) throw new Error("Product JAN differs from URL")
    price = String(p.offers.price)
    const displayedTaxPrice = match(html, /name="price_tax_included"\s+value="([^"]+)"/)
    if (!displayedTaxPrice || Number(displayedTaxPrice) !== Number(price)) throw new Error("Structured and displayed tax prices differ")
    available = /\/InStock$/.test(p.offers.availability || "")
    imageUrl = typeof p.image === "string" ? p.image : ""
    brand = plain(p.brand?.name || "")
  }
  if (!name || !validJan(barcode)) throw new Error("Missing name or invalid JAN checksum")
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(price || "")) throw new Error("Invalid price format")
  const amount = Number(price.replaceAll(",", ""))
  if (!(amount > 0 && amount <= 2147483647)) throw new Error("Invalid price range")
  const reasons = []
  if (!Number.isInteger(amount)) reasons.push("fractional_tax_price_requires_checkout_rounding_rule")
  if (!available) reasons.push("not_confirmed_in_stock")
  if (/(?:\d+\s*(?:個|本|袋|箱|点|枚|パック)\s*セット|ケース販売|ケース売り|まとめ買い)/.test(name.normalize("NFKC"))) reasons.push("bundle_requires_identity_review")
  return { source, storeId: `${source}-online`, barcode, name, brand, imageUrl, priceRaw: price,
    priceYen: Number.isInteger(amount) ? amount : null, currency: "JPY", taxIncluded: true, channel: "online",
    shippingIncluded: false, available, eligible: reasons.length === 0, reviewReasons: reasons, sourceUrl: url, collectedAt,
    evidenceSha256: createHash("sha256").update(html).digest("hex") }
}

export function parseStore(html, url, collectedAt = new Date().toISOString()) {
  const u = new URL(url)
  if (u.origin === "https://shop.tsuruha-g.com" && /^\/\d+[a-z]?$/.test(u.pathname)) {
    const data = JSON.parse(match(html, /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/))
    const s = data["@graph"]?.find((x) => x?.["@type"] === "Pharmacy" || x?.["@type"] === "Store")
    const address = plain(match(html, /<address>([\s\S]*?)<\/address>/)).replace(/^〒[\d-]+\s*/, "")
    if (!s?.name || !address || !s.geo || !Number.isFinite(Number(s.geo.latitude)) || !Number.isFinite(Number(s.geo.longitude))
      || s.geo.latitude < 20 || s.geo.latitude > 46 || s.geo.longitude < 122 || s.geo.longitude > 154) throw new Error("Incomplete Tsuruha physical store")
    return { id: `tsuruha-group-${u.pathname.slice(1)}`, name: s.name,
      chain_name: ["ツルハドラッグ", "くすりのレデイ", "くすりの福太郎", "ウォンツ", "ウェルネス", "杏林堂", "ドラッグイレブン"].find((n) => s.name.includes(n)) || "ツルハグループ",
      address, pref: s.address.addressRegion, city: s.address.addressLocality, lat: Number(s.geo.latitude), lng: Number(s.geo.longitude),
      hours: Array.isArray(s.openingHours) ? s.openingHours.join("; ") : "", channel: "physical", sourceUrl: url, collectedAt }
  }
  if (u.origin !== sources.matsukiyo.base || !/^\d+$/.test(u.searchParams.get("kid") || "")) throw new Error("Unexpected store URL")
  const name = meta(html, "og:title").split(" | ")[0]
  const address = plain(match(html, /<li class="iconAdd">([^<]+)/))
  const lat = Number(match(html, /var latitude = ([\d.]+);/))
  const lng = Number(match(html, /var longitude = ([\d.]+);/))
  if (!name || !address || lat < 20 || lat > 46 || lng < 122 || lng > 154) throw new Error("Incomplete physical store")
  const hours = [...html.matchAll(/<th>([月火水木金土日]曜日)<\/th>\s*<td>([^<]+)<\/td>/g)].map((m) => `${m[1]} ${plain(m[2])}`).join("; ")
  return { id: `mcc-${u.searchParams.get("kid")}`, name,
    chain_name: /マツモトキヨシ/.test(name) ? "マツモトキヨシ" : /ココカラファイン/.test(name) ? "ココカラファイン" : "マツキヨココカラグループ",
    address, pref: match(address, /^(東京都|北海道|大阪府|京都府|.{2,3}県)/), city: "", lat, lng, hours,
    channel: "physical", sourceUrl: url, collectedAt }
}

export function parseWelciaStore(s, collectedAt) {
  if (!/^[\da-z]+$/i.test(s.code) || !s.name || !s.address_name || s.status !== "normal" || !s.coord
    || !Number.isFinite(s.coord.lat) || !Number.isFinite(s.coord.lon) || s.coord.lat < 20 || s.coord.lat > 46 || s.coord.lon < 122 || s.coord.lon > 154) throw new Error("Incomplete or inactive Welcia store")
  const details = (s.detail_groups || []).flatMap((g) => (g.texts || []).flatMap((t) => t.details || []))
  const searchable = (s.detail_groups || []).flatMap((g) => (g.flags || []).flatMap((t) => t.details || [])).find((d) => d.code === "00258")
  if (searchable?.value !== true) throw new Error("Not listed for public store search")
  if (!["ドラッグストア", "薬局"].includes(details.find((d) => d.code === "00002")?.value)) throw new Error("Not a drugstore or pharmacy (excluded from scope)")
  const rawHours = details.find((d) => d.code === "00007")?.value || ""
  let hours = rawHours
  if (rawHours.startsWith("{")) {
    const h = JSON.parse(rawHours)
    hours = Object.entries({ monday: "月", tuesday: "火", wednesday: "水", thursday: "木", friday: "金", saturday: "土", sunday: "日" })
      .filter(([d]) => Array.isArray(h[d])).map(([d, name]) => `${name} ${h[d].map((range) => range.join("–")).join(", ") || "休業"}`).join("; ")
  }
  return { id: `welcia-${s.code}`, name: s.name, chain_name: s.categories?.[0]?.name || "ウエルシアグループ",
    address: s.address_name, pref: match(s.address_name, /^(東京都|北海道|大阪府|京都府|.{2,3}県)/), city: "",
    lat: s.coord.lat, lng: s.coord.lon, hours, channel: "physical",
    sourceUrl: `https://store.welcia.co.jp/welcia/spot/detail?code=${s.code}`, collectedAt }
}

export function buildImportSql(products, physicalStores) {
  const eligible = products.filter((p) => p.eligible)
  const stores = [...physicalStores, ...Object.entries(sources).filter(([id]) => eligible.some((p) => p.source === id)).map(([id, s]) => ({
    id: `${id}-online`, name: s.name, chain_name: s.name.replace("（オンライン）", ""), address: "オンラインストア（実店舗ではありません）", pref: "", city: "", lat: null, lng: null, hours: "",
  }))]
  // Use hex-encoded JSON: source text cannot terminate SQL strings or psql COPY input.
  const jsonSql = (rows) => `convert_from(decode('${Buffer.from(JSON.stringify(rows)).toString("hex")}', 'hex'), 'UTF8')::jsonb`
  return `-- Generated official-source observations; online prices never assigned to physical branches.
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtext('aaprice-drugstore-import'));
create temp table drugstore_products as select * from jsonb_to_recordset(${jsonSql(eligible)}) as x(
  source text, "storeId" text, barcode text, name text, brand text, "imageUrl" text, "priceYen" integer, "sourceUrl" text, "collectedAt" timestamptz);
create temp table drugstore_stores as select * from jsonb_to_recordset(${jsonSql(stores)}) as x(
  id text, name text, chain_name text, address text, pref text, city text, lat double precision, lng double precision, hours text);
insert into public.stores (id,name,chain_name,address,pref,city,lat,lng,hours)
select id,name,chain_name,address,pref,city,lat,lng,hours from drugstore_stores
on conflict (id) do update set name=excluded.name,chain_name=excluded.chain_name,address=excluded.address,
pref=excluded.pref,lat=excluded.lat,lng=excluded.lng,hours=excluded.hours;
insert into public.products (id,barcode,name,brand,pack,category,description,image_url,catalog_source,last_seen_at)
select distinct on (barcode) barcode,barcode,name,brand,'','','',coalesce("imageUrl",''),source,"collectedAt"
from drugstore_products s where not exists(select 1 from public.products p where p.barcode=s.barcode)
order by barcode,"collectedAt" desc
on conflict do nothing;
insert into public.prices (product_id,store_id,price_yen,source,note,collected_at)
select p.id,s."storeId",s."priceYen",'crawler','公式オンライン・税込・送料別（店頭価格ではありません） ' || s."sourceUrl",s."collectedAt"
from drugstore_products s join public.products p on p.barcode=s.barcode
where s."collectedAt" >= now() - interval '7 days'
and not exists (select 1 from public.prices old where old.product_id=p.id and old.store_id=s."storeId"
and old.source='crawler' and old.price_yen=s."priceYen" and old.collected_at >= s."collectedAt" - interval '20 hours');
commit;
`
}

export function deduplicateProducts(products) {
  const byUrl = [...new Map([...products].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).map((p) => [`${p.source}:${p.sourceUrl}`, p])).values()]
  const unique = [...new Map([...byUrl].sort((a, b) => Number(a.eligible) - Number(b.eligible) || a.collectedAt.localeCompare(b.collectedAt))
    .map((p) => [`${p.source}:${p.barcode}`, p])).values()]
  return { unique, review: byUrl.filter((p) => !p.eligible) }
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => args.find((x) => x.startsWith(`--${name}=`))?.split("=").slice(1).join("=") || fallback
  const selectedSources = option("sources", Object.keys(sources).join(",")).split(",").filter(Boolean)
  if (!selectedSources.length || selectedSources.some((source) => !sources[source])) throw new Error(`Unknown price source; choose from ${Object.keys(sources).join(",")}`)
  const importFile = option("import", "")
  if (importFile) {
    if (args.length !== 1 || !process.env.AAPRICE_DB_URL) throw new Error("Use --import=<SQL file> alone and configure AAPRICE_DB_URL")
    console.log(databaseProcess(process.env.AAPRICE_DB_URL, await readFile(importFile, "utf8")))
    return
  }
  const limit = Number(option("limit", "300")), storeLimit = Number(option("stores", "200")), welciaStoreLimit = Number(option("welcia-stores", "3000"))
  const start = Number(option("start", "0"))
  if (![limit, storeLimit, welciaStoreLimit].every((n) => Number.isInteger(n) && n >= 0 && n <= 10000) || !limit) throw new Error("Limits must be integers: products 1–10000, stores 0–10000")
  const out = option("out", `artifacts/drugstores-${new Date().toISOString().slice(0, 10)}`)
  const cache = `${out}/cache`
  await mkdir(cache, { recursive: true })
  const failures = [], products = [], stores = [], discovered = {}, lastRequest = new Map(), robotsByOrigin = new Map()
  async function saveResults() {
    const { unique, review } = deduplicateProducts(products)
    const uniqueStores = [...new Map(stores.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).map((s) => [s.id, s])).values()]
    const baselineText = await readFile(`${out}/existing-products.json`, "utf8").catch(() => "")
    const baseline = baselineText ? JSON.parse(baselineText) : null
    const existingJans = new Set(baseline?.rows?.map((p) => p.barcode) || [])
    const eligibleJans = new Set(unique.filter((p) => p.eligible).map((p) => p.barcode))
    const report = { generatedAt: new Date().toISOString(), databaseApplied: false, offlineCache: args.includes("--offline"), limitPerSource: limit, storeLimit, discovered,
      sources: Object.fromEntries(Object.keys(sources).map((s) => [s, { captured: unique.filter((p) => p.source === s).length, eligible: unique.filter((p) => p.source === s && p.eligible).length }])),
      physicalStores: uniqueStores.length, welciaStoreLimit, storeChains: [...new Set(uniqueStores.map((s) => s.chain_name))],
      comparableAcrossNewSources: [...new Set(unique.filter((p) => p.eligible).map((p) => p.barcode))].filter((jan) => unique.filter((p) => p.eligible && p.barcode === jan).length > 1).length,
      existingCatalog: baseline ? { readAt: baseline.readAt, rows: baseline.rows.length,
        matchingPricedJans: [...eligibleJans].filter((jan) => existingJans.has(jan)).length,
        matchingPriceRows: unique.filter((p) => p.eligible && existingJans.has(p.barcode)).length,
        newPricedJans: [...eligibleJans].filter((jan) => !existingJans.has(jan)).length } : null,
      reviewRows: review.length, failures }
    await writeFile(`${out}/products.json`, JSON.stringify(unique, null, 2))
    await writeFile(`${out}/stores.json`, JSON.stringify(uniqueStores, null, 2))
    await writeFile(`${out}/review.json`, JSON.stringify(review, null, 2))
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    await writeFile(`${out}/import.sql`, buildImportSql(unique, uniqueStores))
    console.log(JSON.stringify({ ...report, failures: failures.length }, null, 2))
    if (selectedSources.some((source) => !report.sources[source].eligible) || (storeLimit && !uniqueStores.length)) throw new Error("A source has no usable rows; inspect report before import")
  }
  // Recover completed observations after an interrupted run without making network requests or changing timestamps.
  if (args.includes("--offline")) {
    for (const file of (await readdir(cache)).filter((f) => /^[a-f0-9]{64}\.json$/.test(f))) {
      let s
      try {
        s = JSON.parse(await readFile(`${cache}/${file}`, "utf8"))
        if (!Number.isFinite(Date.parse(s.collectedAt))) throw new Error("Cache is missing a valid observation timestamp")
        const source = /^https:\/\/shop\.tsuruha\.co\.jp\/\d{8,13}\.html$/.test(s.url) ? "tsuruha"
          : /^https:\/\/www\.e-welcia\.com\/product\/\d+$/.test(s.url) ? "welcia"
          : /^https:\/\/www\.matsukiyococokara-online\.com\/store\/catalog\/product\/view\/id\/\d+$/.test(s.url) ? "matsukiyo" : ""
        if (source) products.push(parseProduct(source, s.html, s.url, s.collectedAt))
        else if (/^https:\/\/(?:shop\.tsuruha-g\.com\/\d+[a-z]?|www\.matsukiyococokara-online\.com\/map\?kid=\d+)$/.test(s.url)) stores.push(parseStore(s.html, s.url, s.collectedAt))
        else if (s.url.startsWith("https://store.welcia.co.jp/welcia/api/proxy2/shop/list?")) {
          for (const item of JSON.parse(s.html).items) {
            try { stores.push({ ...parseWelciaStore(item, s.collectedAt), sourceApiUrl: s.url }) } catch (e) { failures.push({ url: s.url, code: item.code, reason: e.message }) }
          }
        }
      } catch (e) { failures.push({ url: s?.url, cacheFile: file, reason: e.message }) }
    }
    await saveResults()
    return
  }
  async function get(url) {
    const policy = robotsByOrigin.get(new URL(url).origin)
    if (policy && !robotsAllow(policy, url)) throw new Error(`robots.txt disallows ${url}`)
    const file = `${cache}/${createHash("sha256").update(url).digest("hex")}.json`
    try { const saved = JSON.parse(await readFile(file, "utf8")); if (Date.now() - Date.parse(saved.collectedAt) < 86400000) return saved } catch {}
    const host = new URL(url).host
    const gap = host.includes("e-shop.kokumin.co.jp") ? 250 : host.includes("seims.co.jp") ? 200 : 1100
    const delay = Math.max(0, (lastRequest.get(host) || 0) + gap - Date.now())
    await new Promise((r) => setTimeout(r, delay))
    lastRequest.set(host, Date.now())
    let response, html
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        lastRequest.set(host, Date.now())
        response = await fetch(url, { headers: { "User-Agent": "AAPriceCatalog/1.0 (public product price research)" }, signal: AbortSignal.timeout(url.endsWith(".xml") ? 60000 : 20000) })
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
        if (!response.ok) break
        html = await response.text()
        break
      } catch (e) {
        if (attempt === 1) throw new Error(`${url}: ${e.message}`)
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    if (new URL(response.url).origin !== new URL(url).origin) throw new Error("Unexpected cross-origin redirect")
    const saved = { url, collectedAt: new Date().toISOString(), html }
    await writeFile(file, JSON.stringify(saved))
    return saved
  }
  async function collect(source, urls) {
    discovered[source] = urls.length
    let count = 0
    for (const url of urls.slice(start, start + limit)) {
      try {
        const s = await get(url)
        if (source === "qols") {
          const j = JSON.parse((await get(`${url}.js`)).html), v = j.variants?.[0]
          if (!v?.barcode || !validJan(v.barcode) || !Number.isFinite(v.price) || v.price <= 0) throw new Error("Missing QOL variant barcode or price")
          const imageUrl = j.featured_image?.startsWith("//") ? `https:${j.featured_image}` : (j.featured_image || "")
          products.push({ source, storeId: `${source}-online`, barcode: v.barcode, name: plain(j.title || v.name), brand: plain(j.vendor || ""), imageUrl, priceRaw: String(v.price / 100), priceYen: Math.round(v.price / 100), currency: "JPY", taxIncluded: true, channel: "online", shippingIncluded: false, available: v.available === true, eligible: v.available === true, reviewReasons: v.available === true ? [] : ["not_confirmed_in_stock"], sourceUrl: url, collectedAt: s.collectedAt, evidenceSha256: createHash("sha256").update(s.html).digest("hex") })
        } else products.push(parseProduct(source, s.html, url, s.collectedAt))
      }
      catch (e) { failures.push({ source, url, reason: e.message }); if (/HTTP (403|429)/.test(e.message)) break }
      count++
      if (count % 50 === 0) console.log(`${source}: checked ${count}/${Math.min(start + limit, urls.length)}`)
    }
    await writeFile(`${out}/${source}.json`, JSON.stringify(products.filter((p) => p.source === source), null, 2))
  }
  const robots = {}
  for (const [id, source] of Object.entries(sources).filter(([id]) => selectedSources.includes(id))) {
    robots[id] = await get(`${source.base}/robots.txt`).then((r) => r.html).catch(() => "")
    robotsByOrigin.set(source.base, robots[id])
  }
  await writeFile(`${out}/robots.json`, JSON.stringify(robots, null, 2))
  // Only observed public product paths and the official sitemap are traversed; no account, cart, or Tsuruha search routes.
  const sourceRuns = Promise.allSettled([
    (async () => {
      if (!selectedSources.includes("tsuruha")) return
      const home = (await get(sources.tsuruha.base)).html
      const productLinks = (html) => links(html, sources.tsuruha.base).filter((u) => /^https:\/\/shop\.tsuruha\.co\.jp\/\d{8,13}\.html$/.test(u))
      const urls = new Set(productLinks(home))
      for (const category of links(home, sources.tsuruha.base).filter((u) => /^https:\/\/shop\.tsuruha\.co\.jp\/(?:\d{1,5}\/)*\d{1,5}\.html$/.test(u))) {
        if (urls.size >= limit) break
        for (const u of productLinks((await get(category)).html)) urls.add(u)
      }
      await collect("tsuruha", [...urls])
    })(),
    (async () => {
      if (!selectedSources.includes("ainz")) return
      const catalog = JSON.parse((await get(`${sources.ainz.base}/products.json?limit=250&page=1`)).html)
      const urls = (catalog.products || []).map((p) => `${sources.ainz.base}/products/${encodeURIComponent(p.handle)}`)
      await collect("ainz", urls)
    })(),
    (async () => {
      if (!selectedSources.includes("kirindo")) return
      const home = (await get(`${sources.kirindo.base}/p/search?keyword=%E3%83%AD%E3%83%BC%E3%83%88`)).html
      const urls = [...new Set([...home.matchAll(/href="([^"]*\/\d{13})"/g)].map((m) => new URL(m[1], sources.kirindo.base).href))]
      await collect("kirindo", urls)
    })(),
    (async () => {
      if (!selectedSources.includes("tomods")) return
      const home = (await get(`${sources.tomods.base}/shop/goods/search.aspx?keyword=%E3%83%AD%E3%83%BC%E3%83%88&search=%E6%A4%9C%E7%B4%A2%E3%81%99%E3%82%8B`)).html
      const urls = [...new Set([...home.matchAll(/\/shop\/g\/g\d{13}\/?/g)].map((m) => new URL(m[0], sources.tomods.base).href))]
      await collect("tomods", urls)
    })(),
    (async () => {
      if (!selectedSources.includes("kokumin")) return
      const urls = new Set()
      for (let page = 1; page <= 40 && urls.size < limit; page++) {
        const home = (await get(`${sources.kokumin.base}/view/search?page=${page}&sort=recommend`)).html
        const found = [...home.matchAll(/href="(\/view\/item\/\d+)"/g)].map((m) => new URL(m[1], sources.kokumin.base).href)
        found.forEach((u) => urls.add(u))
        if (!found.length) break
      }
      await collect("kokumin", [...urls])
    })(),
    (async () => {
      if (!selectedSources.includes("create")) return
      const home = (await get(`${sources.create.base}/shop/default.aspx`)).html
      const urls = [...new Set([...home.matchAll(/href="(\/shop\/g\/g\d{13}\/?)/g)].map((m) => new URL(m[1], sources.create.base).href))]
      await collect("create", urls)
    })(),
    (async () => {
      if (!selectedSources.includes("kyorindo")) return
      const urls = new Set()
      for (const keyword of ["ロート", "薬", "化粧水", "風邪", "ビタミン", "シャンプー"]) {
        const q = encodeURIComponent(keyword)
        const home = (await get(`${sources.kyorindo.base}/shop/goods/search.aspx?keyword=${q}&search=%E6%A4%9C%E7%B4%A2%E3%81%99%E3%82%8B`)).html
        for (const m of home.matchAll(/href="(\/shop\/g\/g\d{13}\/?)/g)) urls.add(new URL(m[1], sources.kyorindo.base).href)
      }
      await collect("kyorindo", [...urls])
    })(),
    (async () => {
      if (!selectedSources.includes("doramori")) return
      const home = (await get(sources.doramori.base)).html
      const urls = [...new Set([...home.matchAll(/href="(\/i\/\d{9,13})"/g)].map((m) => new URL(m[1], sources.doramori.base).href))]
      await collect("doramori", urls)
    })(),
    (async () => {
      if (!selectedSources.includes("sugi")) return
      const catalog = JSON.parse((await get(`${sources.sugi.base}/products.json?limit=250&page=4`)).html)
      const urls = (catalog.products || []).map((p) => `${sources.sugi.base}/products/${encodeURIComponent(p.handle)}`)
      await collect("sugi", urls)
    })(),
    (async () => {
      if (!selectedSources.includes("seims")) return
      const urls = new Set()
      for (const category of ["c1001", "c2001", "c3001", "c4001", "c5001"]) {
        for (let page = 1; page <= 50; page++) {
          const suffix = page === 1 ? "" : `_p${page}`
          const home = (await get(`${sources.seims.base}/shop/c/${category}${suffix}/`)).html
          const found = [...home.matchAll(/href=["'](\/shop\/g\/g\d{13}\/?)["']/g)]
          for (const m of found) urls.add(new URL(m[1], sources.seims.base).href)
          if (!found.length) break
        }
      }
      await collect("seims", [...urls])
    })(),
    (async () => {
      if (!selectedSources.includes("qols")) return
      const urls = new Set()
      for (let page = 1; page <= 10 && urls.size < limit; page++) {
        const catalog = JSON.parse((await get(`${sources.qols.base}/products.json?limit=250&page=${page}`)).html)
        const products = catalog.products || []
        for (const p of products) urls.add(`${sources.qols.base}/products/${encodeURIComponent(p.handle)}`)
        if (products.length < 250) break
      }
      await collect("qols", [...urls])
    })(),
    (async () => {
      if (!selectedSources.includes("welcia")) return
      const home = (await get(sources.welcia.base)).html
      const urls = new Set(links(home, sources.welcia.base).filter((u) => /\/product\/\d+$/.test(u)))
      for (const cat of links(home, sources.welcia.base).filter((u) => /\/category\/\d+$/.test(u))) {
        if (urls.size >= limit) break
        for (const u of links((await get(cat)).html, sources.welcia.base).filter((u) => /\/product\/\d+$/.test(u))) urls.add(u)
      }
      await collect("welcia", [...urls])
    })(),
    (async () => {
      if (!storeLimit || !selectedSources.includes("tsuruha")) return
      const base = "https://shop.tsuruha-g.com"
      robotsByOrigin.set(base, (await get(`${base}/robots.txt`)).html)
      const index = locs((await get(`${base}/sitemap.xml`)).html)
      const urls = []
      for (const map of index) {
        if (new URL(map).origin !== base) throw new Error("Unexpected physical sitemap host")
        urls.push(...locs((await get(map)).html).filter((u) => /^https:\/\/shop\.tsuruha-g.com\/\d+[a-z]?$/.test(u)))
        if (urls.length >= storeLimit) break
      }
      discovered.tsuruhaPhysicalStores = urls.length
      for (const url of urls.filter((_, i) => i % Math.max(1, Math.floor(urls.length / storeLimit)) === 0).slice(0, storeLimit)) {
        try { const s = await get(url); stores.push(parseStore(s.html, url, s.collectedAt)) }
        catch (e) { failures.push({ source: "tsuruha-physical", url, reason: e.message }); if (/HTTP (403|429)/.test(e.message)) break }
      }
      console.log(`Tsuruha physical stores: ${stores.filter((s) => s.id.startsWith("tsuruha-group-")).length}`)
    })(),
    (async () => {
      if (!welciaStoreLimit || !selectedSources.includes("welcia")) return
      const base = "https://store.welcia.co.jp"
      robotsByOrigin.set(base, (await get(`${base}/robots.txt`)).html)
      for (let offset = 0; offset < welciaStoreLimit; offset += 100) {
        const url = `${base}/welcia/api/proxy2/shop/list?add=detail_group&datum=wgs84&limit=100&offset=${offset}&ex-code=only.prior&ignore-i18n=true&timeStamp=${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`
        const saved = await get(url), data = JSON.parse(saved.html)
        if (!Array.isArray(data.items) || !Number.isInteger(data.count?.total)) throw new Error("Invalid Welcia store payload")
        discovered.welciaPhysicalStores = data.count.total
        for (const s of data.items.slice(0, welciaStoreLimit - offset)) {
          try { stores.push({ ...parseWelciaStore(s, saved.collectedAt), sourceApiUrl: url }) } catch (e) { failures.push({ source: "welcia-physical", code: s.code, reason: e.message }) }
        }
        if (offset + 100 >= data.count.total) break
      }
      console.log(`Welcia physical stores: ${stores.filter((s) => s.id.startsWith("welcia-")).length}`)
    })(),
  ])
  const matsukiyoRun = (async () => {
  if (selectedSources.includes("matsukiyo")) {
  const mkList = (await get(`${sources.matsukiyo.base}/store/catalogsearch/result`)).html
  const mkUrls = [...new Set([
    ...products.filter((p) => p.eligible).map((p) => `${sources.matsukiyo.base}/store/catalog/product/view/id/${p.barcode}`),
    ...links(mkList, sources.matsukiyo.base).filter((u) => /\/store\/catalog\/product\/view\/id\/\d+$/.test(u)),
  ])]
  await collect("matsukiyo", mkUrls)
  }
  })()
  await matsukiyoRun
  const sourceResults = await sourceRuns
  sourceResults.forEach((r, i) => { if (r.status === "rejected") failures.push({ source: ["tsuruha", "welcia", "tsuruha-physical", "welcia-physical"][i], reason: r.reason.message }) })
  if (!selectedSources.includes("matsukiyo")) { await saveResults(); return }
  const storeMap = locs((await get(`${sources.matsukiyo.base}/sitemap_map.xml`)).html).filter((u) => /^https:\/\/www\.matsukiyococokara-online\.com\/map\?kid=\d+$/.test(u))
  discovered.physicalStores = storeMap.length
  // Spread the initial batch across the sitemap, which groups banners by ID.
  const selectedStores = storeMap.filter((_, i) => i % Math.max(1, Math.floor(storeMap.length / Math.max(1, storeLimit))) === 0).slice(0, storeLimit)
  for (const url of selectedStores) {
    try { const s = await get(url); stores.push(parseStore(s.html, url, s.collectedAt)) }
    catch (e) { failures.push({ source: "physical-store", url, reason: e.message }); if (/HTTP (403|429)/.test(e.message)) break }
    if ((stores.length % 50) === 0) console.log(`Physical stores: ${stores.length}`)
  }
  await saveResults()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1 })
}
