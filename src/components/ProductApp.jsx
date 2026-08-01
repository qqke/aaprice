import { motion } from "motion/react"
import { BadgeJapaneseYen, ExternalLink, Heart, LoaderCircle, LocateFixed, MapPin, Save, Store } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import AppShell, { AppLoading } from "@/components/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fetchCreditSummary,
  fetchCurrentProfile,
  fetchFavorites,
  fetchPersonalLogs,
  fetchPricesForProduct,
  fetchProductById,
  friendlyApiError,
  getSession,
  mapProductRow,
  offersFromPriceRows,
  recordRecentView,
  savePersonalLog,
  searchStores,
  submitStorePrice,
  toggleFavorite,
} from "@/lib/aprice-api.mjs"
import { distanceKm, formatDistance, formatPrice, formatUnitPrice, getPriceStats } from "@/lib/products.mjs"

const formatDate = (value) => value ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未知"

export default function ProductApp() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [product, setProduct] = useState(null)
  const [priceRows, setPriceRows] = useState([])
  const [stores, setStores] = useState([])
  const [favorites, setFavorites] = useState([])
  const [logs, setLogs] = useState([])
  const [credit, setCredit] = useState(null)
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [priceLoading, setPriceLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [storeSearch, setStoreSearch] = useState("")
  const [historyLimit, setHistoryLimit] = useState(12)
  const [form, setForm] = useState({ store_id: "", price_yen: "", note: "", evidence_url: "", share_to_public: false })

  const productId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("id") || ""

  const loadPrivate = async (id, activeSession, coordinates = null) => {
    setPriceLoading(true)
    try {
      const [rows, storeRows, favoriteRows, logRows, summary] = await Promise.all([
        fetchPricesForProduct(id, { token: activeSession.access_token, lat: coordinates?.lat, lng: coordinates?.lng, sinceDays: 60 }),
        searchStores("", 300),
        fetchFavorites(activeSession.user.id),
        fetchPersonalLogs(activeSession.user.id),
        fetchCreditSummary(),
      ])
      setPriceRows(rows)
      setStores(storeRows)
      setFavorites(favoriteRows)
      setLogs(logRows.filter((item) => String(item.product_id) === String(id)))
      setCredit(summary)
    } finally {
      setPriceLoading(false)
    }
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
        const activeSession = await getSession()
        if (!active) return
        setSession(activeSession)
        if (activeSession) {
          setProfile(await fetchCurrentProfile())
          await loadPrivate(productId, activeSession)
        }
      } catch (error) {
        if (active) setStatus(friendlyApiError(error))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const offers = useMemo(() => offersFromPriceRows(priceRows), [priceRows])
  const pricedProduct = product ? { ...product, offers } : null
  const stats = pricedProduct ? getPriceStats(pricedProduct) : null
  const productFavorite = favorites.some((item) => item.entity_type === "product" && String(item.entity_id) === String(productId))
  const filteredStores = useMemo(() => {
    const needle = storeSearch.trim().normalize("NFKC").toLocaleLowerCase("ja-JP")
    if (!needle) return stores
    return stores.filter((store) => [store.name, store.chain_name, store.pref, store.city, store.address].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP").includes(needle))
  }, [storeSearch, stores])

  const locate = () => {
    if (!navigator.geolocation) { setStatus("当前浏览器不支持定位，请手动搜索门店。"); return }
    setStatus("正在定位附近门店…")
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const next = { lat: coords.latitude, lng: coords.longitude }
      setLocation(next)
      const nearestStore = stores
        .filter((store) => Number.isFinite(Number(store.lat)) && Number.isFinite(Number(store.lng)))
        .map((store) => ({ ...store, distance: distanceKm(next.lat, next.lng, Number(store.lat), Number(store.lng)) }))
        .toSorted((a, b) => a.distance - b.distance)[0]
      if (nearestStore) setForm((value) => ({ ...value, store_id: nearestStore.id }))
      setStatus(nearestStore ? `已选择最近门店：${nearestStore.name}（${formatDistance(nearestStore.distance)}）。` : "已按当前位置重新查询门店价格。")
      try { await loadPrivate(productId, session, next) } catch (error) { setStatus(friendlyApiError(error)) }
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

  const favoriteStore = async (storeId) => {
    try {
      const result = await toggleFavorite("store", storeId)
      setFavorites((items) => result.action === "added" ? [...items, { entity_type: "store", entity_id: storeId }] : items.filter((item) => !(item.entity_type === "store" && String(item.entity_id) === String(storeId))))
      setStatus(result.action === "added" ? "已收藏门店。" : "已取消门店收藏。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const savePrice = async (event) => {
    event.preventDefault()
    if (form.share_to_public && !form.store_id) { setStatus("提交公共价格时必须选择门店。"); return }
    setStatus("正在保存价格…")
    try {
      const entry = { product_id: productId, store_id: form.store_id || null, price_yen: Number(form.price_yen), note: form.note.trim(), purchased_at: new Date().toISOString().slice(0, 10) }
      await savePersonalLog(entry)
      if (form.share_to_public) await submitStorePrice({ ...entry, store_id: form.store_id, evidence_url: form.evidence_url.trim(), share_to_public: true })
      setForm({ store_id: "", price_yen: "", note: "", evidence_url: "", share_to_public: false })
      const refreshedLogs = await fetchPersonalLogs(session.user.id)
      setLogs(refreshedLogs.filter((item) => String(item.product_id) === String(productId)))
      setStatus(form.share_to_public ? "个人记录已保存，公共价格已提交审核。" : "个人价格记录已保存。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  if (loading) return <AppShell title="商品详情"><AppLoading label="正在读取商品" /></AppShell>
  if (!product) return <AppShell eyebrow="商品" title="无法打开商品" description={status}><div className="mx-auto max-w-[1440px] px-4 pb-24"><Button asChild><a href="/">返回搜索</a></Button></div></AppShell>

  return (
    <AppShell eyebrow={product.maker} title={product.name} description={`${product.pack}，JAN ${product.barcode || "未登记"}`} session={session} profile={profile} actions={session && <div className="flex gap-2"><Button variant="outline" onClick={locate} disabled={priceLoading}><LocateFixed /> 定位门店</Button><Button variant={productFavorite ? "default" : "outline"} onClick={favoriteProduct}><Heart className={productFavorite ? "fill-current" : ""} /> {productFavorite ? "已收藏" : "收藏"}</Button></div>}>
      <section className="mx-auto grid max-w-[1320px] gap-8 px-4 pb-24 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="overflow-hidden rounded-3xl border bg-card shadow-[0_20px_60px_oklch(0.18_0.03_178_/_0.06)]">
            <div className="aspect-[4/3] bg-muted"><img src={product.image} alt={product.name} className="h-full w-full object-cover" /></div>
            <div className="p-6"><div className="flex flex-wrap gap-2"><Badge>{product.category}</Badge><Badge variant="outline">{product.pack}</Badge></div><p className="mt-5 text-sm leading-relaxed text-muted-foreground">{product.active}</p></div>
          </motion.div>
          {credit && <div className="mt-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm"><span>价格查询额度</span><span className="font-mono">积分 {credit.balance ?? 0}</span></div>}
        </div>

        <div className="space-y-10">
          {!session ? (
            <div className="rounded-3xl border bg-card p-6 shadow-[0_20px_60px_oklch(0.18_0.03_178_/_0.06)]"><h2 className="text-xl font-semibold">登录后查看门店价格</h2><p className="mt-2 text-sm text-muted-foreground">价格查询、收藏和个人记录沿用原后台账户规则。</p><Button asChild className="mt-5"><a href={`/login/?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}>登录继续</a></Button></div>
          ) : (
            <>
              <section>
                <div className="flex items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">最近 60 天</p><h2 className="mt-1 text-2xl font-semibold">门店价格</h2></div>{priceLoading && <LoaderCircle className="animate-spin text-primary" />}</div>
                {offers.length ? <div className="mt-5 divide-y border-y">{offers.toSorted((a, b) => (location ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : a.price - b.price)).map((offer) => {
                  const isFavorite = favorites.some((item) => item.entity_type === "store" && String(item.entity_id) === String(offer.id))
                  const mapUrl = Number.isFinite(offer.lat) && Number.isFinite(offer.lng) ? `https://www.google.com/maps/search/?api=1&query=${offer.lat},${offer.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(offer.name)}`
                  return <div key={offer.id} className="flex flex-wrap items-center gap-4 py-5"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="size-5" /></div><div className="min-w-0 flex-1"><h3 className="font-medium">{offer.name}</h3><p className="mt-1 text-xs text-muted-foreground">{offer.address || offer.chain}{offer.distance !== null && ` · ${formatDistance(offer.distance)}`} · {formatDate(offer.sampledAt)}</p></div><div className="text-right"><p className="font-mono text-xl font-semibold">{formatPrice(offer.price)}</p><p className="text-xs text-muted-foreground">{offer.member ? "会员价" : "店头价"}</p></div><Button variant="ghost" size="icon" onClick={() => favoriteStore(offer.id)} aria-label={isFavorite ? `取消收藏 ${offer.name}` : `收藏 ${offer.name}`}><Heart className={isFavorite ? "fill-current text-primary" : ""} /></Button><Button asChild variant="ghost" size="icon"><a href={mapUrl} target="_blank" rel="noreferrer" aria-label={`在地图查看 ${offer.name}`}><ExternalLink /></a></Button></div>
                })}</div> : <div className="mt-5 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">当前没有近期门店报价。</div>}
              </section>

              <section className="grid gap-4 sm:grid-cols-3">
                <div className="border-t pt-4"><p className="text-sm text-muted-foreground">当前最低</p><p className="mt-2 font-mono text-2xl font-semibold">{formatPrice(stats.min)}</p></div>
                <div className="border-t pt-4"><p className="text-sm text-muted-foreground">单位价格</p><p className="mt-2 font-mono text-2xl font-semibold">{formatUnitPrice(pricedProduct)}</p></div>
                <div className="border-t pt-4"><p className="text-sm text-muted-foreground">门店差价</p><p className="mt-2 font-mono text-2xl font-semibold">{formatPrice(stats.saving)}</p></div>
              </section>

              <section className="rounded-2xl border bg-card p-6">
                <div><h2 className="text-xl font-semibold">记录店头价格</h2><p className="mt-2 text-sm text-muted-foreground">默认仅保存到个人记录；勾选后同时提交公共审核。</p></div>
                <form onSubmit={savePrice} className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label><span className="mb-2 block text-sm font-medium">搜索门店</span><Input type="search" value={storeSearch} onChange={(event) => setStoreSearch(event.target.value)} placeholder="店名、连锁、城市或地址" /></label>
                  <label><span className="mb-2 block text-sm font-medium">门店</span><select value={form.store_id} onChange={(event) => selectStore(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">不指定门店</option>{filteredStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
                  <label><span className="mb-2 block text-sm font-medium">价格（日元）</span><Input type="number" min="1" value={form.price_yen} onChange={(event) => setForm({ ...form, price_yen: event.target.value })} required /></label>
                  <label><span className="mb-2 block text-sm font-medium">备注</span><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="会员价、促销等" /></label>
                  <label><span className="mb-2 block text-sm font-medium">凭证 URL</span><Input type="url" value={form.evidence_url} onChange={(event) => setForm({ ...form, evidence_url: event.target.value })} placeholder="可选" /></label>
                  <label className="flex items-center gap-3 text-sm sm:col-span-2"><input type="checkbox" checked={form.share_to_public} onChange={(event) => setForm({ ...form, share_to_public: event.target.checked })} /> 同时提交公共比价审核</label>
                  <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><Button type="submit"><Save /> 保存价格</Button>{status && <p className="text-sm text-muted-foreground" role="status">{status}</p>}</div>
                </form>
              </section>

              <section>
                <div><p className="text-sm text-muted-foreground">原始采样</p><h2 className="mt-1 text-2xl font-semibold">近期变化</h2></div>
                <div className="mt-5 divide-y border-y">{priceRows.slice(0, historyLimit).map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-medium">{row.stores?.name || row.store_id}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(row.collected_at)} · {row.source || "unknown"}</p></div><span className="font-mono font-semibold">{formatPrice(row.price_yen)}</span></div>)}</div>
                {priceRows.length > historyLimit && <Button variant="ghost" className="mt-4" onClick={() => setHistoryLimit((value) => value + 12)}>查看更多记录</Button>}
              </section>

              {logs.length > 0 && <section><h2 className="text-2xl font-semibold">我的历史记录</h2><div className="mt-5 divide-y border-y">{logs.slice(0, 10).map((log) => <div key={log.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-medium">{log.stores?.name || "未指定门店"}</p><p className="mt-1 text-xs text-muted-foreground">{log.purchased_at || log.created_at} · {log.note || "无备注"}</p></div><span className="font-mono font-semibold">{formatPrice(log.price_yen)}</span></div>)}</div></section>}
            </>
          )}
        </div>
      </section>
    </AppShell>
  )
}
