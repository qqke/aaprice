export const MAX_COMPARE = 6
export const MAX_PRICE = 3200
export const MIN_PRICE = 500
export const PRICE_SNAPSHOT_MAX_AGE = 6 * 60 * 60 * 1000

export const stores = {
  matsukiyo: { id: "matsukiyo-shibuya", name: "マツモトキヨシ 渋谷店", chain: "マツモトキヨシ", lat: 35.6595, lng: 139.7005 },
  welcia: { id: "welcia-shinjuku", name: "ウエルシア 新宿三丁目店", chain: "ウエルシア", lat: 35.6899, lng: 139.7035 },
  sundrug: { id: "sundrug-ikebukuro", name: "サンドラッグ 池袋駅前店", chain: "サンドラッグ", lat: 35.7296, lng: 139.7101 },
  cocokara: { id: "cocokara-ginza", name: "ココカラファイン 銀座店", chain: "ココカラファイン", lat: 35.6719, lng: 139.7648 },
}

const offer = (store, price, member = false) => ({
  ...stores[store],
  price,
  member,
  sampledAt: "2026-07-28",
})

export const products = [
  {
    id: "loxonin-s",
    barcode: "4987188161027",
    name: "ロキソニンS",
    maker: "第一三共ヘルスケア",
    category: "止痛退热",
    pack: "12錠",
    amount: 12,
    unit: "錠",
    active: "ロキソプロフェンナトリウム水和物",
    target: "头痛、生理痛、牙痛",
    score: 9.4,
    tags: ["第1类医药品", "速效型"],
    image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("matsukiyo", 748), offer("welcia", 798), offer("sundrug", 820)],
  },
  {
    id: "eve-a",
    barcode: "4987300064010",
    name: "EVE A錠",
    maker: "エスエス製薬",
    category: "止痛退热",
    pack: "24錠",
    amount: 24,
    unit: "錠",
    active: "イブプロフェン",
    target: "头痛、生理痛、咽喉痛",
    score: 9.1,
    tags: ["指定第2类医药品", "小粒片"],
    image: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("sundrug", 888), offer("welcia", 920, true), offer("cocokara", 960)],
  },
  {
    id: "tylenol-a",
    barcode: "4987123701905",
    name: "タイレノールA",
    maker: "ジョンソン・エンド・ジョンソン",
    category: "止痛退热",
    pack: "20錠",
    amount: 20,
    unit: "錠",
    active: "アセトアミノフェン",
    target: "发热、头痛、关节痛",
    score: 8.8,
    tags: ["第2类医药品", "空腹时可服"],
    image: "https://images.unsplash.com/photo-1576602976047-174e57a47881?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("matsukiyo", 1080), offer("cocokara", 1180), offer("welcia", 1260)],
  },
  {
    id: "rohto-lycee-contact",
    barcode: "4987241123456",
    name: "ロートリセコンタクトw",
    maker: "ロート製薬",
    category: "眼部护理",
    pack: "8mL",
    amount: 8,
    unit: "mL",
    active: "コンドロイチン硫酸エステルナトリウム",
    target: "隐形眼镜佩戴时的眼疲劳",
    score: 8.9,
    tags: ["第3类医药品", "隐形可用"],
    image: "https://images.unsplash.com/photo-1609840114035-3c981b782dfe?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("matsukiyo", 1298), offer("cocokara", 1360), offer("sundrug", 1420)],
  },
  {
    id: "sante-fx-neo",
    barcode: "4987084310291",
    name: "サンテFXネオ",
    maker: "参天製薬",
    category: "眼部护理",
    pack: "12mL",
    amount: 12,
    unit: "mL",
    active: "ネオスチグミンメチル硫酸塩",
    target: "眼疲劳、结膜充血",
    score: 8.5,
    tags: ["第2类医药品", "清凉感"],
    image: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("welcia", 598), offer("sundrug", 648), offer("matsukiyo", 680)],
  },
  {
    id: "anessa-perfect-uv",
    barcode: "4909978120756",
    name: "アネッサ パーフェクトUV",
    maker: "資生堂",
    category: "防晒",
    pack: "60mL",
    amount: 60,
    unit: "mL",
    active: "SPF50+ / PA++++",
    target: "户外、耐水防晒",
    score: 9.2,
    tags: ["耐水", "面部身体"],
    image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("matsukiyo", 2480, true), offer("cocokara", 2680), offer("welcia", 2880)],
  },
  {
    id: "biore-aqua-rich",
    barcode: "4901301413245",
    name: "ビオレUV アクアリッチ",
    maker: "花王",
    category: "防晒",
    pack: "70g",
    amount: 70,
    unit: "g",
    active: "SPF50+ / PA++++",
    target: "日常通勤、轻盈防晒",
    score: 9.0,
    tags: ["水感", "性价比"],
    image: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("sundrug", 798), offer("welcia", 880), offer("matsukiyo", 948)],
  },
  {
    id: "curel-face-cream",
    barcode: "4901301236219",
    name: "キュレル 潤浸保湿フェイスクリーム",
    maker: "花王",
    category: "保湿",
    pack: "40g",
    amount: 40,
    unit: "g",
    active: "セラミド機能成分、ユーカリエキス",
    target: "干燥性敏感肌、面部保湿",
    score: 9.3,
    tags: ["医药部外品", "敏感肌"],
    image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("cocokara", 1980), offer("matsukiyo", 2180), offer("welcia", 2380)],
  },
  {
    id: "ihada-medicated-balm",
    barcode: "4909978204135",
    name: "イハダ 薬用バーム",
    maker: "資生堂",
    category: "保湿",
    pack: "20g",
    amount: 20,
    unit: "g",
    active: "高精製ワセリン、抗肌荒れ有効成分",
    target: "反复干燥、肌肤屏障护理",
    score: 8.7,
    tags: ["医药部外品", "低刺激"],
    image: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=1200&q=82",
    offers: [offer("welcia", 1350), offer("matsukiyo", 1480), offer("cocokara", 1650)],
  },
]

export const segments = ["全部", "止痛退热", "眼部护理", "防晒", "保湿"]

export const cleanJanCode = (value = "") => String(value).replace(/\D/g, "")

export function getImageSrcSet(value) {
  try {
    const url = new URL(value)
    if (!/^(?:images\.unsplash\.com|cdn\.shopify\.com)$/.test(url.hostname)) return undefined
    return [480, 800, 1200].map((width) => {
      url.searchParams.set(url.hostname === "images.unsplash.com" ? "w" : "width", width)
      return `${url} ${width}w`
    }).join(", ")
  } catch { return undefined }
}

export function isOnlineStore(store = {}) {
  return String(store.id || "") === "sundrug-00000" || /オンライン|online/i.test(String(store.name || ""))
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => value * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

export function getPriceStats(product) {
  const prices = product.offers.map(({ price }) => price)
  if (!prices.length) return { min: null, max: null, saving: null, bestOffer: null, storeCount: 0 }
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return {
    min,
    max,
    saving: max - min,
    bestOffer: product.offers.find(({ price }) => price === min),
    storeCount: product.offers.length,
  }
}

export function getBasketSummary(items = []) {
  return items.reduce((summary, product) => {
    const stats = getPriceStats(product)
    if (stats.min === null) return summary
    return {
      ...summary,
      pricedCount: summary.pricedCount + 1,
      minimumTotal: summary.minimumTotal + stats.min,
      visibleSaving: summary.visibleSaving + stats.saving,
    }
  }, { totalCount: items.length, pricedCount: 0, minimumTotal: 0, visibleSaving: 0 })
}

export function getBestSingleStoreBasket(items = []) {
  if (!items.length || items.some(({ offers }) => !offers.length)) return null
  const minimumTotal = getBasketSummary(items).minimumTotal
  return items[0].offers
    .filter((store) => !isOnlineStore(store))
    .map((store) => {
      const offers = items.map((product) => product.offers.find(({ id }) => id === store.id))
      if (offers.some((offer) => !offer)) return null
      const total = offers.reduce((sum, { price }) => sum + price, 0)
      return { id: store.id, name: store.name, address: store.address, lat: store.lat, lng: store.lng, total, premium: total - minimumTotal, includesMemberPrice: offers.some(({ member }) => member) }
    })
    .filter(Boolean)
    .toSorted((a, b) => a.total - b.total)[0] || null
}

export function getMapUrl(place = {}) {
  const query = Number.isFinite(place.lat) && Number.isFinite(place.lng)
    ? `${place.lat},${place.lng}`
    : [place.name, place.address].filter(Boolean).join(" ")
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function sanitizePriceSnapshots(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(-MAX_COMPARE).flatMap(([productId, snapshot]) => {
    const savedAt = Number(snapshot?.savedAt)
    if (!productId || !Number.isFinite(savedAt) || savedAt > now + 300_000 || now - savedAt > PRICE_SNAPSHOT_MAX_AGE || !Array.isArray(snapshot.offers)) return []
    const offers = snapshot.offers.slice(0, 50).flatMap((offer) => {
      const price = Number(offer?.price)
      if (!offer?.id || !offer?.name || !Number.isFinite(price) || price <= 0 || price > 10_000_000) return []
      return [{
        id: String(offer.id).slice(0, 128),
        name: String(offer.name).slice(0, 200),
        chain: String(offer.chain || "").slice(0, 200),
        address: String(offer.address || "").slice(0, 300),
        lat: Number.isFinite(offer.lat) ? offer.lat : null,
        lng: Number.isFinite(offer.lng) ? offer.lng : null,
        price,
        member: Boolean(offer.member),
        sampledAt: typeof offer.sampledAt === "string" && Number.isFinite(Date.parse(offer.sampledAt)) ? offer.sampledAt : null,
        distance: Number.isFinite(offer.distance) ? offer.distance : null,
      }]
    })
    return offers.length ? [[String(productId).slice(0, 128), { savedAt, offers }]] : []
  }))
}

export function sanitizeCompareSelection(value, max = MAX_COMPARE) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, max)
}

export function getCompareSelectionFromSearch(search = "") {
  const value = new URLSearchParams(search).get("compare")
  return sanitizeCompareSelection(value ? value.split(",") : [])
}

export function getClosestOffer(product, location) {
  if (!location || !product.offers.length) return null
  return product.offers
    .filter((item) => !isOnlineStore(item) && Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .map((item) => ({ ...item, distance: distanceKm(location.lat, location.lng, item.lat, item.lng) }))
    .toSorted((a, b) => a.distance - b.distance)[0] || null
}

export const getUnitPrice = (product) => {
  const price = getPriceStats(product).min
  return price === null ? null : price / product.amount
}

export function filterProducts(items, { query = "", segment = "全部", maxPrice = MAX_PRICE, sort = "score", location = null } = {}) {
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase("ja-JP")
  const janNeedle = cleanJanCode(query)
  const filtered = items.filter((product) => {
    const text = [product.name, product.maker, product.category, product.barcode, product.pack, product.active, product.target, ...product.tags]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
    const matchesQuery = !needle || text.includes(needle) || (janNeedle.length >= 4 && product.barcode.includes(janNeedle))
    return matchesQuery
      && (segment === "全部" || product.category === segment)
      && (getPriceStats(product).min === null || getPriceStats(product).min <= maxPrice)
  })

  return filtered.toSorted((a, b) => {
    if (sort === "price") return (getPriceStats(a).min ?? Infinity) - (getPriceStats(b).min ?? Infinity)
    if (sort === "unit") return (getUnitPrice(a) ?? Infinity) - (getUnitPrice(b) ?? Infinity)
    if (sort === "saving") return (getPriceStats(b).saving ?? -1) - (getPriceStats(a).saving ?? -1)
    if (sort === "distance" && location) {
      return (getClosestOffer(a, location)?.distance ?? Infinity) - (getClosestOffer(b, location)?.distance ?? Infinity)
    }
    return b.score - a.score
  })
}

export function formatPrice(value) {
  if (value === null || value === undefined) return "待查询"
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value)
}

export function getPriceFreshness(value, now = Date.now()) {
  if (!value) return { ageDays: null, label: "更新时间未知", stale: true }
  const sampledAt = new Date(value).getTime()
  if (!Number.isFinite(sampledAt)) return { ageDays: null, label: "更新时间未知", stale: true }
  const ageDays = Math.max(0, Math.floor((Number(now) - sampledAt) / 86_400_000))
  if (ageDays === 0) return { ageDays, label: "今日采集", stale: false }
  if (ageDays <= 30) return { ageDays, label: `${ageDays} 天前采集`, stale: false }
  return { ageDays, label: `超过 30 天`, stale: true }
}

export function formatUnitPrice(product) {
  const price = getUnitPrice(product)
  return price === null ? "待查询" : `${new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 1 }).format(price)}/${product.unit}`
}

export const formatDistance = (value) => value < 1 ? `${Math.round(value * 1000)}m` : `${value.toFixed(1)}km`
