import { motion } from "motion/react"
import { ArrowLeft, BadgeJapaneseYen, Heart, LoaderCircle, LocateFixed, MapPin, Save, Scale, Store } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import AppShell, { AppLoading } from "@/components/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fetchCreditSummary,
  fetchCommercialOffers,
  fetchCurrentProfile,
  fetchFavorites,
  fetchPersonalLogs,
  fetchPricesForProduct,
  fetchProductById,
  fetchPublicPricePreview,
  friendlyApiError,
  getSession,
  mapProductRow,
  offersFromPriceRows,
  recordRecentView,
  recordCommercialClick,
  recordTelemetryEvent,
  savePersonalLog,
  searchStores,
  submitStorePrice,
  toggleFavorite,
} from "@/lib/aprice-api.mjs"
import { distanceKm, formatDistance, formatPrice, formatUnitPrice, getImageSrcSet, getMapUrl, getPriceFreshness, getPriceStats, isOnlineStore, sanitizeCompareSelection } from "@/lib/products.mjs"
import { appPath } from "@/lib/paths.mjs"

const formatDate = (value) => value ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未知"
const COMPARE_SELECTION_KEY = "aprice:compare-selection"

export default function ProductApp() {
  const pageParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)
  const productId = pageParams.get("id") || ""
  const taskFlow = pageParams.get("task") === "1"
  const requestedStoreId = String(pageParams.get("store") || "").slice(0, 128)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [product, setProduct] = useState(null)
  const [priceRows, setPriceRows] = useState([])
  const [stores, setStores] = useState([])
  const [favorites, setFavorites] = useState([])
  const [logs, setLogs] = useState([])
  const [credit, setCredit] = useState(null)
  const [pricePreview, setPricePreview] = useState(null)
  const [commercialOffer, setCommercialOffer] = useState(null)
  const [commercialBusy, setCommercialBusy] = useState(false)
  const [commercialStatus, setCommercialStatus] = useState("")
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [priceLoading, setPriceLoading] = useState(false)
  const [pricesLoaded, setPricesLoaded] = useState(false)
  const [savingPrice, setSavingPrice] = useState(false)
  const [status, setStatus] = useState("")
  const [storeSearch, setStoreSearch] = useState("")
  const [historyLimit, setHistoryLimit] = useState(12)
  const [form, setForm] = useState({ store_id: requestedStoreId, price_yen: "", note: "", evidence_url: "", share_to_public: taskFlow })

  const loadPrivate = async (id, activeSession) => {
    const [storeResult, favoriteResult, logResult, summaryResult] = await Promise.allSettled([
      searchStores("", 300), fetchFavorites(activeSession.user.id), fetchPersonalLogs(activeSession.user.id), fetchCreditSummary(),
    ])
    if (storeResult.status === "fulfilled") setStores(storeResult.value)
    if (favoriteResult.status === "fulfilled") {
      setFavorites(favoriteResult.value)
      if (favoriteResult.value.some((item) => item.entity_type === "product" && String(item.entity_id) === String(id))) void recordTelemetryEvent("favorite_revisited", { entity_type: "product", product_id: id }).catch(() => {})
    }
    if (logResult.status === "fulfilled") setLogs(logResult.value.filter((item) => String(item.product_id) === String(id)))
    if (summaryResult.status === "fulfilled") setCredit(summaryResult.value)
    const failed = [storeResult, favoriteResult, logResult, summaryResult].find((result) => result.status === "rejected")
    if (failed) setStatus(friendlyApiError(failed.reason))
  }

  const loadPrices = async () => {
    if (!session || priceLoading) return
    setPriceLoading(true)
    setStatus("")
    try {
      const rows = await fetchPricesForProduct(productId, { token: session.access_token, lat: location?.lat, lng: location?.lng })
      setPriceRows(rows)
      setPricesLoaded(true)
      const offerCount = offersFromPriceRows(rows).length
      void recordTelemetryEvent(offerCount ? "price_query_succeeded" : "price_query_empty", { product_id: productId, offer_count: offerCount, has_location: Boolean(location) }).catch(() => {})
      fetchCreditSummary().then(setCredit).catch(() => {})
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setPriceLoading(false) }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        if (!productId) throw new Error("URL 中缺少商品 id")
        const row = await fetchProductById(productId)
        if (!row) throw new Error("数据库中没有这件商品")
        if (!active) return
        const mappedProduct = mapProductRow(row)
        setProduct(mappedProduct)
        recordRecentView(mappedProduct)
        void recordTelemetryEvent("product_viewed", { product_id: productId }).catch(() => {})
        fetchCommercialOffers([productId]).then((rows) => {
          if (!active) return
          const offer = rows[0] || null
          setCommercialOffer(offer)
          if (offer) void recordTelemetryEvent("commercial_offer_seen", { offer_id: offer.id, product_id: productId, source: "product" }).catch(() => {})
        }).catch(() => {})
        const activeSession = await getSession()
        if (!active) return
        setSession(activeSession)
        if (activeSession) {
          setProfile(await fetchCurrentProfile())
          await loadPrivate(productId, activeSession)
        } else {
          const preview = await fetchPublicPricePreview(productId).catch(() => null)
          setPricePreview(preview)
          if (preview) void recordTelemetryEvent("public_price_preview_seen", { product_id: productId, store_count: preview.storeCount }).catch(() => {})
        }
      } catch (error) {
        if (active) setStatus(friendlyApiError(error))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!loading && window.location.hash === "#record-price") requestAnimationFrame(() => document.getElementById("record-price")?.scrollIntoView({ block: "start" }))
  }, [loading])

  const offers = useMemo(() => offersFromPriceRows(priceRows).map((offer) => location && !isOnlineStore(offer) && Number.isFinite(offer.lat) && Number.isFinite(offer.lng) ? { ...offer, distance: distanceKm(location.lat, location.lng, offer.lat, offer.lng) } : offer), [priceRows, location])
  const newestOffer = offers.toSorted((a, b) => new Date(b.sampledAt || 0) - new Date(a.sampledAt || 0))[0]
  const freshness = getPriceFreshness(newestOffer?.sampledAt)
  const pricedProduct = product ? { ...product, offers } : null
  const stats = pricedProduct ? getPriceStats(pricedProduct) : null
  const closestOfferId = location ? offers.filter(({ distance }) => Number.isFinite(distance)).toSorted((a, b) => a.distance - b.distance)[0]?.id : null
  const recommendedOffer = offers.find(({ id }) => String(id) === String(closestOfferId)) || stats?.bestOffer
  const freePriceQueriesRemaining = credit ? Math.max(0, Number(credit.daily_free_price_references || 0) - Number(credit.references_today || 0)) : null
  const priceQueryCost = Math.max(0, Number(credit?.price_reference_cost || 0))
  const canAffordPriceQuery = freePriceQueriesRemaining === null || freePriceQueriesRemaining > 0 || priceQueryCost === 0 || Number(credit?.balance || 0) >= priceQueryCost
  const priceQueryCopy = freePriceQueriesRemaining === null ? "主动查询才计入今日价格查询额度。" : freePriceQueriesRemaining > 0 ? `今日还可免费查询 ${freePriceQueriesRemaining} 次；点击后计入额度。` : !canAffordPriceQuery ? `查询需要 ${priceQueryCost} 积分，当前余额 ${Number(credit?.balance || 0)}。可通过补价任务获得积分。` : priceQueryCost > 0 ? `免费额度已用完，本次查询消耗 ${priceQueryCost} 积分。` : "主动查询才计入今日价格查询额度。"
  const priceQueryLabel = freePriceQueriesRemaining > 0 ? "免费查询报价" : priceQueryCost > 0 ? `用 ${priceQueryCost} 积分查价` : "查询报价"
  const productFavorite = favorites.some((item) => item.entity_type === "product" && String(item.entity_id) === String(productId))
  const physicalStores = stores.filter((store) => !isOnlineStore(store))
  const filteredStores = useMemo(() => {
    const needle = storeSearch.trim().normalize("NFKC").toLocaleLowerCase("ja-JP")
    if (!needle) return physicalStores
    return physicalStores.filter((store) => [store.name, store.chain_name, store.pref, store.city, store.address].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP").includes(needle))
  }, [storeSearch, stores])
  const locate = () => {
    if (!navigator.geolocation) { setStatus("当前浏览器不支持定位，请手动搜索门店。"); return }
    setStatus("正在定位附近门店…")
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const next = { lat: coords.latitude, lng: coords.longitude }
      setLocation(next)
      const nearestStore = physicalStores
        .filter((store) => Number.isFinite(Number(store.lat)) && Number.isFinite(Number(store.lng)))
        .map((store) => ({ ...store, distance: distanceKm(next.lat, next.lng, Number(store.lat), Number(store.lng)) }))
        .toSorted((a, b) => a.distance - b.distance)[0]
      if (nearestStore) setForm((value) => ({ ...value, store_id: nearestStore.id }))
      setStatus(nearestStore ? `已选择最近门店：${nearestStore.name}（${formatDistance(nearestStore.distance)}）。` : "已保存位置，查询后将按距离排序。")
    }, (error) => setStatus(`定位失败：${error.message}`), { timeout: 10000, maximumAge: 30000 })
  }

  const selectStore = (storeId) => {
    const latestPrice = offers.find((offer) => String(offer.id) === String(storeId))?.price
    setForm((value) => ({ ...value, store_id: storeId, price_yen: value.price_yen || (latestPrice ? String(latestPrice) : "") }))
  }

  const favoriteProduct = async () => {
    try {
      const result = await toggleFavorite("product", productId)
      setFavorites((items) => result.action === "added" ? [...items, { entity_type: "product", entity_id: productId }] : items.filter((item) => !(item.entity_type === "product" && String(item.entity_id) === String(productId))))
      setStatus(result.action === "added" ? "已收藏商品。" : "已取消商品收藏。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const compareProduct = () => {
    let ids = [productId]
    try { ids = sanitizeCompareSelection([productId, ...JSON.parse(localStorage.getItem(COMPARE_SELECTION_KEY) || "[]")]) } catch {}
    window.location.assign(appPath(`/?compare=${ids.map((id) => encodeURIComponent(id)).join(",")}&compare_source=product`))
  }

  const openCommercialOffer = async () => {
    if (!commercialOffer || commercialBusy) return
    setCommercialBusy(true)
    setCommercialStatus("正在前往合作商店…")
    try { window.location.assign(await recordCommercialClick(commercialOffer.id, "product")) } catch (error) { setCommercialStatus(friendlyApiError(error)); setCommercialBusy(false) }
  }
  const commercialSection = commercialOffer && <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="border-y py-5"><div className="flex items-center justify-between gap-4"><div><p className="text-xs text-muted-foreground">合作链接 · 购买可能为 AAPRICE 带来收益</p><h2 className="mt-1 font-semibold">楽天市场购买</h2></div><Button variant="outline" onClick={openCommercialOffer} disabled={commercialBusy}>{commercialBusy ? <LoaderCircle className="animate-spin" /> : <ArrowLeft className="rotate-180" />}{commercialBusy ? "跳转中" : "合作购买"}</Button></div>{commercialStatus && <p className="mt-3 text-xs text-muted-foreground" role="status">{commercialStatus}</p>}</motion.section>

  const favoriteStore = async (storeId) => {
    try {
      const result = await toggleFavorite("store", storeId)
      setFavorites((items) => result.action === "added" ? [...items, { entity_type: "store", entity_id: storeId }] : items.filter((item) => !(item.entity_type === "store" && String(item.entity_id) === String(storeId))))
      setStatus(result.action === "added" ? "已收藏门店。" : "已取消门店收藏。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const savePrice = async (event) => {
    event.preventDefault()
    if (savingPrice) return
    if (form.share_to_public && !form.store_id) { setStatus("提交公共价格时必须选择门店。"); return }
    setSavingPrice(true)
    setStatus("正在保存价格…")
    try {
      const entry = { product_id: productId, store_id: form.store_id || null, price_yen: Number(form.price_yen), note: form.note.trim(), purchased_at: new Date().toISOString().slice(0, 10) }
      await savePersonalLog(entry)
      if (form.share_to_public) {
        await submitStorePrice({ ...entry, store_id: form.store_id, evidence_url: form.evidence_url.trim(), share_to_public: true })
        if (taskFlow) void recordTelemetryEvent("task_submitted", { product_id: productId, has_store: true }).catch(() => {})
      }
      setForm({ store_id: "", price_yen: "", note: "", evidence_url: "", share_to_public: false })
      const refreshedLogs = await fetchPersonalLogs(session.user.id)
      setLogs(refreshedLogs.filter((item) => String(item.product_id) === String(productId)))
      setStatus(taskFlow ? "补价任务已提交审核，审核通过后发放积分。" : form.share_to_public ? "个人记录已保存，公共价格已提交审核。" : "个人价格记录已保存。")
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setSavingPrice(false) }
  }

  if (loading) return <AppShell title="商品详情"><AppLoading label="正在读取商品" /></AppShell>
  if (!product) return <AppShell eyebrow="商品" title="无法打开商品" description={status}><div className="mx-auto max-w-[1440px] px-4 pb-24"><Button asChild><a href={appPath("/")}>返回搜索</a></Button></div></AppShell>

  return (
    <AppShell title={product.name} description={[product.maker, product.pack !== "规格未登记" && product.pack, product.barcode && `JAN ${product.barcode}`].filter(Boolean).join(" / ")} session={session} profile={profile} actions={<div className="flex flex-wrap gap-2"><Button asChild variant="ghost"><a href={appPath("/#catalog")}><ArrowLeft /> 返回结果</a></Button><Button variant="outline" onClick={compareProduct}><Scale />加入比价</Button>{session && <><Button variant="outline" onClick={locate} disabled={priceLoading}><LocateFixed /> 定位门店</Button><Button variant={productFavorite ? "default" : "outline"} onClick={favoriteProduct}><Heart className={productFavorite ? "fill-current" : ""} /> {productFavorite ? "已收藏" : "收藏"}</Button></>}</div>}>
      <section className="mx-auto grid max-w-[1320px] gap-8 px-4 pb-32 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:pb-24">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="overflow-hidden rounded-3xl border bg-card shadow-[0_20px_60px_oklch(0.18_0.03_178_/_0.06)]">
            <div className="aspect-[4/3] bg-muted"><img src={product.image} srcSet={getImageSrcSet(product.image)} sizes="(min-width: 1024px) 40vw, 100vw" width="1200" height="900" alt={product.name} fetchPriority="high" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" /></div>
            <div className="p-6"><div className="flex flex-wrap gap-2"><Badge>{product.category}</Badge>{product.pack !== "规格未登记" && <Badge variant="outline">{product.pack}</Badge>}</div>{product.active !== "商品说明未登记" && <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{product.active}</p>}</div>
          </motion.div>
          {credit && <div className="mt-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm"><span>价格查询额度</span><span className="font-mono">积分 {credit.balance ?? 0}</span></div>}
        </div>

        <div className="space-y-10">
          {!session ? (
            <><div className="rounded-3xl border bg-card p-6 shadow-[0_20px_60px_oklch(0.18_0.03_178_/_0.06)]">{pricePreview ? <><p className="text-sm text-muted-foreground">匿名价格预览</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-3xl font-semibold">{formatPrice(pricePreview.minPrice)}</p><p className="mt-2 text-sm text-muted-foreground">{pricePreview.storeCount} 个报价来源 · {getPriceFreshness(pricePreview.latestCollectedAt).label}</p></div><Button asChild className="hidden lg:inline-flex"><a href={appPath(`/login/?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)} onClick={() => void recordTelemetryEvent("login_prompt_clicked", { source: "price_preview", product_id: productId }).catch(() => {})}>登录查看报价</a></Button></div><p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted-foreground">仅展示近期最低价概览。登录后可查看报价来源、采集时间和完整记录。</p></> : <><h2 className="text-xl font-semibold">登录后查看价格</h2><p className="mt-2 text-sm text-muted-foreground">登录后可以查询价格、收藏商品并保存记录。</p><Button asChild className="mt-5 hidden lg:inline-flex"><a href={appPath(`/login/?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)} onClick={() => void recordTelemetryEvent("login_prompt_clicked", { source: "product_gate", product_id: productId }).catch(() => {})}>登录继续</a></Button></>}</div>{commercialSection}</>
          ) : (
            <>
              <section id="store-prices">
                <div className="flex items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">最近一次有效报价</p><h2 className="mt-1 text-2xl font-semibold">可用价格</h2>{offers.length > 0 && <p className="mt-2 text-sm text-muted-foreground">{offers.length} 个报价来源 · {location && offers.some((offer) => !isOnlineStore(offer)) ? "实体店按距离排序" : "按价格排序"} · <span className={freshness.stale ? "text-amber-700 dark:text-amber-400" : "text-foreground"}>{freshness.label}</span></p>}</div>{priceLoading && <LoaderCircle className="animate-spin text-primary" />}</div>
                {offers.length ? <><div className="mt-5 divide-y border-y">{offers.toSorted((a, b) => (location ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : a.price - b.price)).map((offer) => {
                  const isFavorite = favorites.some((item) => item.entity_type === "store" && String(item.entity_id) === String(offer.id))
                  const online = isOnlineStore(offer)
                  const mapUrl = online ? null : getMapUrl(offer)
                  const premium = offer.price - stats.min
                  return <div key={offer.id} className="flex flex-wrap items-center gap-4 py-5"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{offer.name}</h3>{online && <Badge variant="outline">在线</Badge>}{offer.price === stats.min && <Badge>最低</Badge>}{String(offer.id) === String(closestOfferId) && <Badge variant="outline">最近</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{online ? "官方在线商店" : offer.address || offer.chain}{offer.distance !== null && !online && ` · ${formatDistance(offer.distance)}`} · {formatDate(offer.sampledAt)}</p></div><div className="text-right"><p className="font-mono text-xl font-semibold">{formatPrice(offer.price)}</p><p className="text-xs text-muted-foreground">{offer.member ? "会员价" : online ? "在线价" : "店头价"}{premium > 0 && ` · 比最低多 ${formatPrice(premium)}`}</p></div><Button variant="ghost" size="icon" onClick={() => favoriteStore(offer.id)} aria-label={isFavorite ? `取消收藏 ${offer.name}` : `收藏 ${offer.name}`}><Heart className={isFavorite ? "fill-current text-primary" : ""} /></Button>{mapUrl && <Button asChild variant="outline" size="sm"><a href={mapUrl} target="_blank" rel="noreferrer" aria-label={`在地图查看 ${offer.name}`} onClick={() => void recordTelemetryEvent("map_opened", { product_id: productId, store_id: offer.id }).catch(() => {})}><MapPin />地图</a></Button>}</div>
                })}</div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">实体店价格请以店头结算为准；在线价可能另有运费、库存与促销条件。</p></> : pricesLoaded ? <div className="mt-5 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">当前没有近期报价。</div> : <div className="mt-5 rounded-2xl border border-dashed p-8 text-center"><p className="text-sm text-muted-foreground">{priceQueryCopy}</p>{canAffordPriceQuery ? <Button className="mt-4" onClick={loadPrices} disabled={priceLoading}>{priceLoading ? <LoaderCircle className="animate-spin" /> : <BadgeJapaneseYen />}{priceLoading ? "查询中" : priceQueryLabel}</Button> : <Button asChild className="mt-4"><a href={appPath("/me/#price-tasks")}>查看积分与任务</a></Button>}</div>}
              </section>

              {offers.length > 0 && <section className="grid gap-4 sm:grid-cols-3">
                <div className="border-t pt-4"><p className="text-sm text-muted-foreground">当前最低</p><p className="mt-2 font-mono text-2xl font-semibold">{formatPrice(stats.min)}</p></div>
                <div className="border-t pt-4"><p className="text-sm text-muted-foreground">单位价格</p><p className="mt-2 font-mono text-2xl font-semibold">{formatUnitPrice(pricedProduct)}</p></div>
                <div className="border-t pt-4"><p className="text-sm text-muted-foreground">可见差价</p><p className="mt-2 font-mono text-2xl font-semibold">{formatPrice(stats.saving)}</p></div>
              </section>}

              {commercialSection}

              <section id="record-price" className="scroll-mt-24 rounded-2xl border bg-card p-6">
                <div><h2 className="text-xl font-semibold">{taskFlow ? "完成补价任务" : "记录价格"}</h2><p className="mt-2 text-sm text-muted-foreground">{taskFlow ? requestedStoreId ? "任务门店已预选；保存时会同时提交公共价格审核。" : "选择门店并输入价格；保存时会同时提交公共价格审核。" : "只需选择门店并输入价格。"}</p></div>
                <form onSubmit={savePrice} className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label><span className="mb-2 block text-sm font-medium">门店</span><select value={form.store_id} onChange={(event) => selectStore(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">不指定门店</option>{filteredStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
                  <label><span className="mb-2 block text-sm font-medium">价格（日元）</span><Input type="number" min="1" value={form.price_yen} onChange={(event) => setForm({ ...form, price_yen: event.target.value })} required /></label>
                  <details className="sm:col-span-2">
                    <summary className="cursor-pointer text-sm font-medium text-muted-foreground">补充信息与公共提交（可选）</summary>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block text-sm font-medium">搜索门店</span><Input type="search" value={storeSearch} onChange={(event) => setStoreSearch(event.target.value)} placeholder="店名、连锁、城市或地址" /></label><label><span className="mb-2 block text-sm font-medium">备注</span><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="会员价、促销等" /></label><label><span className="mb-2 block text-sm font-medium">凭证 URL</span><Input type="url" value={form.evidence_url} onChange={(event) => setForm({ ...form, evidence_url: event.target.value })} /></label><label className="flex items-center gap-3 self-end pb-2 text-sm"><input type="checkbox" checked={form.share_to_public} onChange={(event) => setForm({ ...form, share_to_public: event.target.checked })} /> 提交公共比价审核</label></div>
                  </details>
                  <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><Button type="submit" disabled={savingPrice}>{savingPrice ? <LoaderCircle className="animate-spin" /> : <Save />}{savingPrice ? "正在保存" : "保存价格"}</Button>{status && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>}</div>
                </form>
              </section>

              {priceRows.length > 0 && <section>
                <div><p className="text-sm text-muted-foreground">原始采样</p><h2 className="mt-1 text-2xl font-semibold">近期变化</h2></div>
                <div className="mt-5 divide-y border-y">{priceRows.slice(0, historyLimit).map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-medium">{row.stores?.name || row.store_id}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(row.collected_at)} · {row.source || "unknown"}</p></div><span className="font-mono font-semibold">{formatPrice(row.price_yen)}</span></div>)}</div>
                {priceRows.length > historyLimit && <Button variant="ghost" className="mt-4" onClick={() => setHistoryLimit((value) => value + 12)}>查看更多记录</Button>}
              </section>}

              {logs.length > 0 && <section><h2 className="text-2xl font-semibold">我的历史记录</h2><div className="mt-5 divide-y border-y">{logs.slice(0, 10).map((log) => <div key={log.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-medium">{log.stores?.name || "未指定门店"}</p><p className="mt-1 text-xs text-muted-foreground">{log.purchased_at || log.created_at} · {log.note || "无备注"}</p></div><span className="font-mono font-semibold">{formatPrice(log.price_yen)}</span></div>)}</div></section>}
            </>
          )}
        </div>
      </section>
      <div className="fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-30 rounded-2xl border bg-popover/92 p-3 shadow-[0_20px_70px_oklch(0.15_0.04_240_/_0.22)] backdrop-blur-xl lg:hidden">
        {session ? <div className="flex gap-2">{recommendedOffer ? isOnlineStore(recommendedOffer) ? <Button asChild className="flex-1"><a href="#store-prices"><BadgeJapaneseYen />在线价 · {formatPrice(recommendedOffer.price)}</a></Button> : <Button asChild className="flex-1"><a href={getMapUrl(recommendedOffer)} target="_blank" rel="noreferrer" onClick={() => void recordTelemetryEvent("map_opened", { source: "mobile_recommendation", product_id: productId, store_id: recommendedOffer.id }).catch(() => {})}><MapPin />{closestOfferId ? "最近门店" : recommendedOffer.member ? "最低会员价" : "最低价门店"} · {formatPrice(recommendedOffer.price)}</a></Button> : canAffordPriceQuery ? <Button className="flex-1" onClick={loadPrices} disabled={priceLoading}>{priceLoading ? <LoaderCircle className="animate-spin" /> : <BadgeJapaneseYen />}{priceLoading ? "查询中" : priceQueryLabel}</Button> : <Button asChild className="flex-1"><a href={appPath("/me/#price-tasks")}>查看积分与任务</a></Button>}<Button variant={productFavorite ? "default" : "outline"} onClick={favoriteProduct}><Heart className={productFavorite ? "fill-current" : ""} /> {productFavorite ? "已收藏" : "收藏"}</Button></div> : <Button asChild className="w-full"><a href={appPath(`/login/?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)} onClick={() => void recordTelemetryEvent("login_prompt_clicked", { source: "mobile_product_gate", product_id: productId }).catch(() => {})}><BadgeJapaneseYen /> 登录查看报价</a></Button>}
      </div>
    </AppShell>
  )
}
