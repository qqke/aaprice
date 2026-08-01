import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  BadgeJapaneseYen,
  Barcode,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  Pill,
  Plus,
  RotateCcw,
  Scale,
  ScanLine,
  Search,
  SlidersHorizontal,
  Store,
  Sun,
  UserRound,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  fetchPricesForProduct,
  fetchJancodeProductDraft,
  fetchProductByBarcode,
  friendlyApiError,
  getSession,
  mapProductRow,
  offersFromPriceRows,
  searchProducts,
  signInWithEmailPassword,
  signOut,
  subscribeAuthState,
  submitProductSubmission,
  supabaseConfigured,
  turnstileEnabled,
  turnstileSiteKey,
} from "@/lib/aprice-api.mjs"
import {
  cleanJanCode,
  filterProducts,
  formatDistance,
  formatPrice,
  formatUnitPrice,
  getClosestOffer,
  getPriceStats,
  MAX_COMPARE,
  MAX_PRICE,
  MIN_PRICE,
  products as demoProducts,
} from "@/lib/products.mjs"

const comparisonRows = [
  ["门店最低价", (product) => formatPrice(getPriceStats(product).min)],
  ["单位价格", formatUnitPrice],
  ["最低价门店", (product) => getPriceStats(product).bestOffer?.name || "待查询"],
  ["规格", (product) => product.pack],
  ["分类", (product) => product.category],
  ["商品说明", (product) => product.active],
  ["有价门店", (product) => `${product.offers.length} 家`],
  ["JAN 码", (product) => product.barcode || "未登记"],
]

function ThemeButton() {
  const [dark, setDark] = useState(false)

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), [])

  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
    setDark(next)
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "切换浅色模式" : "切换深色模式"}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}

function ScannerDialog({ open, onOpenChange, onFound, session }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const [manualCode, setManualCode] = useState("")
  const [status, setStatus] = useState("可启动后置相机，或手动输入 JAN 码。")
  const [scanning, setScanning] = useState(false)
  const [draft, setDraft] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const initialLookupRef = useRef(false)

  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setScanning(false)
  }

  useEffect(() => {
    if (!open) stopCamera()
    return stopCamera
  }, [open])

  useEffect(() => {
    if (!open || initialLookupRef.current) return
    const value = new URLSearchParams(window.location.search).get("jan") || ""
    if (value) {
      initialLookupRef.current = true
      setManualCode(value)
      lookup(value)
    }
  }, [open])

  const lookup = async (value) => {
    const barcode = cleanJanCode(value)
    if (!/^\d{8}$|^\d{12,14}$/.test(barcode)) {
      setStatus("请输入 8 位或 12 到 14 位 JAN 条码。")
      return
    }
    setDraft(null)
    setStatus(`正在查询 ${barcode}…`)
    try {
      const row = supabaseConfigured
        ? await fetchProductByBarcode(barcode)
        : demoProducts.find((product) => product.barcode === barcode)
      if (!row) {
        setStatus(`后台没有找到 JAN ${barcode}，正在尝试补全商品信息…`)
        const external = await fetchJancodeProductDraft(barcode).catch(() => null)
        setDraft(external || { id: barcode, barcode, name: "", brand: "", pack: "", category: "", tone: "sunset", description: "", image_url: "" })
        setStatus(external ? "已从 JANCODE 预填，请确认后提交审核。" : "JANCODE 也没有记录，请手动填写后提交审核。")
        return
      }
      stopCamera()
      onFound(supabaseConfigured ? mapProductRow(row) : row)
    } catch (error) {
      setStatus(friendlyApiError(error))
    }
  }

  const submitMissing = async (event) => {
    event.preventDefault()
    if (!session || !draft) return
    setSubmitting(true)
    try {
      await submitProductSubmission(draft)
      setDraft(null)
      setStatus(`JAN ${draft.barcode} 已提交审核。`)
    } catch (error) {
      setStatus(friendlyApiError(error))
    } finally {
      setSubmitting(false)
    }
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("当前浏览器不支持相机访问，请手动输入 JAN 码。")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setScanning(true)
      if (!("BarcodeDetector" in window)) {
        setStatus("相机已启动，但浏览器不支持自动识别，请手动输入 JAN 码。")
        return
      }
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128"] })
      setStatus("正在寻找条码，请将条码放入取景框。")
      const scan = async () => {
        if (!streamRef.current) return
        try {
          const result = await detector.detect(videoRef.current)
          if (result?.[0]?.rawValue) {
            await lookup(result[0].rawValue)
            return
          }
        } catch {}
        frameRef.current = requestAnimationFrame(scan)
      }
      frameRef.current = requestAnimationFrame(scan)
    } catch {
      stopCamera()
      setStatus("无法启动相机，请检查浏览器相机权限，或手动输入 JAN 码。")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[min(560px,calc(100vw-2rem))] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="size-5 text-primary" /> 扫码检索</DialogTitle>
          <DialogDescription>将商品条码放入取景框，首次使用请允许浏览器访问相机。</DialogDescription>
        </DialogHeader>
        <div className="relative mt-2 aspect-[4/3] overflow-hidden rounded-2xl border bg-slate-950">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="条码扫描相机预览" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 bg-primary" />
          {!scanning && <div className="absolute inset-0 grid place-items-center text-center text-sm text-white/65"><Camera className="mx-auto mb-3 size-8" />相机尚未启动</div>}
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={startCamera} disabled={scanning}><Camera /> 启动相机</Button>
          <Button variant="outline" onClick={stopCamera} disabled={!scanning}>停止</Button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); lookup(manualCode) }}>
          <label htmlFor="manual-jan" className="mb-2 block text-sm font-medium">手动输入 JAN 码</label>
          <div className="flex gap-2"><Input id="manual-jan" value={manualCode} onChange={(event) => setManualCode(event.target.value)} inputMode="numeric" placeholder="例如 4901234567894" /><Button type="submit" variant="secondary">查询</Button></div>
        </form>
        <p className="min-h-5 text-sm text-muted-foreground" role="status">{status}</p>
        {draft && <form className="space-y-3 rounded-2xl border bg-muted/35 p-4" onSubmit={submitMissing}>
          <div><p className="font-medium">补录缺失商品</p><p className="mt-1 text-xs text-muted-foreground">JAN {draft.barcode} · 提交后由管理员审核</p></div>
          <label className="block"><span className="mb-2 block text-sm font-medium">商品名称</span><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-sm font-medium">品牌</span><Input value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label><label className="block"><span className="mb-2 block text-sm font-medium">规格</span><Input value={draft.pack} onChange={(event) => setDraft({ ...draft, pack: event.target.value })} placeholder="例如 30 片" /></label></div>
          <label className="block"><span className="mb-2 block text-sm font-medium">分类</span><Input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium">商品图片 URL <span className="font-normal text-muted-foreground">（可选）</span></span><Input type="url" value={draft.image_url} onChange={(event) => setDraft({ ...draft, image_url: event.target.value })} /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium">商品说明 <span className="font-normal text-muted-foreground">（可选）</span></span><Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          {session ? <Button type="submit" className="w-full" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <Plus />}{submitting ? "正在提交" : "提交审核"}</Button> : <Button asChild className="w-full"><a href={`/login/?redirect=${encodeURIComponent(`/scan/?jan=${draft.barcode}`)}`}><LogIn /> 登录后提交</a></Button>}
        </form>}
      </DialogContent>
    </Dialog>
  )
}

function LoginDialog({ open, onOpenChange, onSignedIn }) {
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [captchaToken, setCaptchaToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !turnstileEnabled) return undefined
    let active = true
    const render = () => {
      if (!active || !turnstileRef.current || !window.turnstile || widgetIdRef.current !== null) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => setCaptchaToken(String(token || "")),
        "expired-callback": () => setCaptchaToken(""),
        "error-callback": () => setCaptchaToken(""),
      })
    }
    if (window.turnstile) render()
    else {
      let script = document.querySelector("script[data-aprice-turnstile]")
      if (!script) {
        script = document.createElement("script")
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        script.async = true
        script.defer = true
        script.dataset.apriceTurnstile = "true"
        document.head.append(script)
      }
      script.addEventListener("load", render, { once: true })
    }
    return () => {
      active = false
      if (widgetIdRef.current !== null) window.turnstile?.remove(widgetIdRef.current)
      widgetIdRef.current = null
      setCaptchaToken("")
    }
  }, [open])

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      const session = await signInWithEmailPassword(email.trim(), password, captchaToken)
      onSignedIn(session)
    } catch (cause) {
      setError(friendlyApiError(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(440px,calc(100vw-2rem))] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>登录 AAPRICE</DialogTitle>
          <DialogDescription>登录后可以查询门店价格；浏览商品与扫码检索无需登录。</DialogDescription>
        </DialogHeader>
        <form className="mt-2 space-y-3" onSubmit={submit}>
          <label className="block"><span className="mb-2 block text-sm font-medium">邮箱</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium">密码</span><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          {turnstileEnabled && <div ref={turnstileRef} className="min-h-[65px]" aria-label="人机验证" />}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || (turnstileEnabled && !captchaToken)}>
            {loading ? <LoaderCircle className="animate-spin" /> : <LogIn />}{loading ? "正在登录" : "登录并查询"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductCard({ product, featured, selected, selectionFull, onToggle, reduceMotion, location, priceLoading, priceChecked, priceError, onLoadPrices }) {
  const stats = getPriceStats(product)
  const closest = getClosestOffer(product, location)
  const offers = product.offers.toSorted((a, b) => a.price - b.price)
  const hasPrices = stats.storeCount > 0

  return (
    <motion.article
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 170, damping: 22 }}
      className={`group relative overflow-hidden rounded-2xl border bg-card shadow-[0_18px_60px_oklch(0.2_0.03_240_/_0.06)] ${featured ? "md:col-span-2" : ""}`}
    >
      <div className={featured ? "grid md:grid-cols-[1.05fr_0.95fr]" : ""}>
        <a href={`/product/?id=${encodeURIComponent(product.id)}`} aria-label={`查看 ${product.name} 详情`} className={`relative block overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring ${featured ? "min-h-72 md:min-h-[31rem]" : "aspect-[4/3]"}`}>
          <motion.img layoutId={`image-${product.id}`} src={product.image} alt={`${product.name} 药妆商品示意图`} loading={featured ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.035]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
          {featured && <div className="absolute bottom-5 left-5 text-white"><p className="text-xs font-medium uppercase tracking-[0.18em] text-white/75">实时目录</p><p className="mt-1 text-lg font-semibold">扫码、搜索、按需查询价格</p></div>}
        </a>

        <div className={`flex flex-col p-5 ${featured ? "justify-between md:p-8" : "gap-5"}`}>
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{product.maker}</p>
                <h2 className={`mt-1 font-semibold tracking-tight ${featured ? "text-2xl md:text-3xl" : "text-xl"}`}><a href={`/product/?id=${encodeURIComponent(product.id)}`} className="outline-none transition hover:text-primary focus-visible:ring-2">{product.name}</a></h2>
              </div>
              <Badge className="shrink-0 gap-1 bg-primary/10 text-primary hover:bg-primary/10"><Store className="size-3" /> {hasPrices ? `${stats.storeCount} 店` : "待查价"}</Badge>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="secondary">{product.category}</Badge>
              {product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-muted-foreground">规格 / 单位价</p><p className="mt-1 font-medium">{product.pack} · {formatUnitPrice(product)}</p></div>
              <div><p className="text-muted-foreground">JAN 码</p><p className="mt-1 break-all font-mono font-medium">{product.barcode || "未登记"}</p></div>
              {featured && <div className="col-span-2"><p className="text-muted-foreground">商品说明</p><p className="mt-1 line-clamp-3 font-medium">{product.active}</p></div>}
            </div>

            {featured && hasPrices && (
              <div className="mt-7 overflow-hidden rounded-xl border bg-muted/35">
                {offers.map((item, index) => (
                  <div key={item.id || item.name} className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${index ? "border-t" : ""}`}>
                    <div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.member ? "会员价" : "店头价"}{location && ` · ${formatDistance(getClosestOffer({ offers: [item] }, location).distance)}`}</p></div>
                    <span className="shrink-0 font-mono font-semibold">{formatPrice(item.price)}</span>
                  </div>
                ))}
              </div>
            )}

            {!featured && hasPrices && <p className="mt-5 truncate text-xs text-muted-foreground">最低 {stats.bestOffer.name}{closest && ` · 最近 ${closest.name} ${formatDistance(closest.distance)}`}</p>}
            {!hasPrices && <p className="mt-5 text-xs text-muted-foreground">{priceError || (priceChecked ? "最近 30 天暂无门店报价。" : "登录后按需查询，不会在浏览目录时消耗额度。")}</p>}
          </div>

          <div className={`flex items-end justify-between gap-4 ${featured ? "mt-8" : "mt-auto"}`}>
            <div>
              <p className="text-xs text-muted-foreground">{hasPrices ? `门店最高 ${formatPrice(stats.max)} · 可省 ${formatPrice(stats.saving)}` : "同一后台实时返回"}</p>
              <p className="font-mono text-2xl font-semibold tracking-tight">{formatPrice(stats.min)}</p>
            </div>
            {hasPrices ? (
              <Button variant={selected ? "default" : "outline"} onClick={() => onToggle(product.id)} disabled={!selected && selectionFull} aria-pressed={selected} className="shrink-0">
                {selected ? <Check /> : <Plus />}{selected ? "已入列" : "加入比较"}
              </Button>
            ) : (
              <Button onClick={() => onLoadPrices(product.id)} disabled={priceLoading} className="shrink-0">
                {priceLoading ? <LoaderCircle className="animate-spin" /> : <BadgeJapaneseYen />}{priceLoading ? "查询中" : priceChecked ? "重新查询" : "查询门店价"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  )
}

function CompareDialog({ open, onOpenChange, selectedProducts, onRemove }) {
  const lowestPrice = Math.min(...selectedProducts.map((product) => getPriceStats(product).min))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[min(1100px,calc(100vw-2rem))] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-5 text-left"><DialogTitle className="text-xl">同类商品并排比较</DialogTitle><DialogDescription>门店报价来自实时价格库，单位价按当前最低价换算。</DialogDescription></DialogHeader>
        <div className="overflow-auto px-4 pb-6 sm:px-6">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `150px repeat(${selectedProducts.length}, minmax(190px, 1fr))` }}>
            <div className="sticky left-0 z-10 bg-popover py-5" />
            {selectedProducts.map((product) => {
              const price = getPriceStats(product).min
              return <div key={product.id} className="border-b px-4 py-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{product.maker}</p><p className="mt-1 font-semibold">{product.name}</p></div><Button variant="ghost" size="icon-sm" onClick={() => onRemove(product.id)} aria-label={`移除 ${product.name}`}><X /></Button></div>{price === lowestPrice && <Badge className="mt-3">当前最低</Badge>}</div>
            })}
            {comparisonRows.flatMap(([label, value]) => [
              <div key={`${label}-label`} className="sticky left-0 z-10 border-b bg-popover py-4 text-sm text-muted-foreground">{label}</div>,
              ...selectedProducts.map((product) => <div key={`${label}-${product.id}`} className="border-b px-4 py-4 text-sm font-medium">{value(product)}</div>),
            ])}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function CompareApp({ initialScan = false }) {
  const reduceMotion = useReducedMotion()
  const [catalog, setCatalog] = useState(supabaseConfigured ? [] : demoProducts)
  const [catalogLoading, setCatalogLoading] = useState(supabaseConfigured)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [catalogError, setCatalogError] = useState("")
  const [query, setQuery] = useState("")
  const [segment, setSegment] = useState("全部")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [budget, setBudget] = useState([MAX_PRICE])
  const [sort, setSort] = useState("score")
  const [selected, setSelected] = useState([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [pendingPriceId, setPendingPriceId] = useState("")
  const [priceLoading, setPriceLoading] = useState({})
  const [priceChecked, setPriceChecked] = useState({})
  const [priceErrors, setPriceErrors] = useState({})
  const [location, setLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState("idle")

  useEffect(() => { if (initialScan) setScanOpen(true) }, [initialScan])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let active = true
    let unsubscribe = () => {}
    getSession().then((value) => { if (active) setSession(value) }).catch(() => {})
    subscribeAuthState((value) => { if (active) setSession(value) }).then((stop) => { unsubscribe = stop }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let active = true
    const timer = setTimeout(async () => {
      setCatalogLoading(true)
      setCatalogError("")
      try {
        const rows = await searchProducts(query)
        if (active) {
          setCatalog(rows.map(mapProductRow))
          setCatalogHasMore(rows.length === 30)
        }
      } catch (error) {
        if (active) {
          setCatalog([])
          setCatalogError(friendlyApiError(error))
        }
      } finally {
        if (active) setCatalogLoading(false)
      }
    }, query ? 300 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query])

  const segments = useMemo(() => ["全部", ...new Set(catalog.map(({ category }) => category).filter(Boolean))].slice(0, 7), [catalog])
  useEffect(() => { if (!segments.includes(segment)) setSegment("全部") }, [segments, segment])

  const filtered = useMemo(() => filterProducts(catalog, { query: supabaseConfigured ? "" : query, segment, maxPrice: budget[0], sort, location }), [catalog, query, segment, budget, sort, location])
  const selectedProducts = selected.map((id) => catalog.find((product) => product.id === id)).filter(Boolean)
  const hasFilters = query || segment !== "全部" || budget[0] !== MAX_PRICE || sort !== "score"

  const toggleProduct = (id) => setSelected((current) => current.includes(id) ? current.filter((productId) => productId !== id) : current.length < MAX_COMPARE ? [...current, id] : current)

  const resetFilters = () => {
    setQuery("")
    setSegment("全部")
    setBudget([MAX_PRICE])
    setSort("score")
  }

  const loadPrices = async (id, accessToken = session?.access_token) => {
    if (!supabaseConfigured) return
    if (!accessToken) {
      setPendingPriceId(id)
      setAuthOpen(true)
      return
    }
    setPriceLoading((value) => ({ ...value, [id]: true }))
    setPriceErrors((value) => ({ ...value, [id]: "" }))
    try {
      const rows = await fetchPricesForProduct(id, { token: accessToken, lat: location?.lat, lng: location?.lng })
      const offers = offersFromPriceRows(rows)
      setCatalog((items) => items.map((product) => product.id === id ? { ...product, offers } : product))
      setPriceChecked((value) => ({ ...value, [id]: true }))
    } catch (error) {
      setPriceErrors((value) => ({ ...value, [id]: friendlyApiError(error) }))
    } finally {
      setPriceLoading((value) => ({ ...value, [id]: false }))
    }
  }

  const handleSignedIn = async (nextSession) => {
    setSession(nextSession)
    setAuthOpen(false)
    const id = pendingPriceId
    setPendingPriceId("")
    if (id) await loadPrices(id, nextSession?.access_token)
  }

  const loadMoreProducts = async () => {
    setCatalogLoadingMore(true)
    setCatalogError("")
    try {
      const rows = await searchProducts(query, 30, { offset: catalog.length })
      setCatalog((items) => [...items, ...rows.map(mapProductRow).filter((row) => !items.some((item) => item.id === row.id))])
      setCatalogHasMore(rows.length === 30)
    } catch (error) {
      setCatalogError(friendlyApiError(error))
    } finally {
      setCatalogLoadingMore(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    setSession(null)
    setSelected([])
    setCatalog((items) => items.map((product) => ({ ...product, offers: [] })))
  }

  const handleScannedProduct = (product) => {
    if (supabaseConfigured) {
      setScanOpen(false)
      window.location.assign(`/product/?id=${encodeURIComponent(product.id)}`)
      return
    }
    setCatalog(demoProducts)
    setQuery(product.barcode)
    setSegment("全部")
    setScanOpen(false)
  }

  const locate = () => {
    if (!navigator.geolocation) { setLocationStatus("unsupported"); return }
    setLocationStatus("loading")
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setLocation({ lat: coords.latitude, lng: coords.longitude }); setLocationStatus("ready") },
      () => setLocationStatus("error"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    )
  }

  const locationCopy = { idle: "使用当前位置", loading: "正在定位…", ready: "已显示门店距离", error: "定位失败，再试一次", unsupported: "浏览器不支持定位" }[locationStatus]

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-3" aria-label="AAPRICE 首页"><span className="grid size-9 place-items-center rounded-xl bg-primary font-mono text-sm font-bold text-primary-foreground">AA</span><span><span className="block font-semibold leading-none tracking-[-0.04em]">AAPRICE</span><span className="mt-1 block text-[10px] leading-none text-muted-foreground">日本药妆比价</span></span></a>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" className="hidden sm:inline-flex"><a href="#catalog">商品比价</a></Button>
            <Button asChild variant="ghost" className="size-9 px-0 sm:w-auto sm:px-2.5"><a href="/scan/" aria-label="扫码检索"><ScanLine /><span className="hidden sm:inline">扫码</span></a></Button>
            {session && <Button asChild variant="ghost" className="size-9 px-0 sm:w-auto sm:px-2.5"><a href="/me/" aria-label="我的账户"><UserRound /><span className="hidden sm:inline">我的</span></a></Button>}
            {supabaseConfigured && (session ? <Button variant="ghost" size="sm" onClick={handleSignOut} className="size-9 px-0 sm:w-auto sm:px-2.5" aria-label="退出登录"><LogOut /><span className="hidden sm:inline">退出</span></Button> : <Button variant="ghost" size="sm" onClick={() => setAuthOpen(true)} className="size-9 px-0 sm:w-auto sm:px-2.5" aria-label="登录"><LogIn /><span className="hidden sm:inline">登录</span></Button>)}
            <ThemeButton />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="mx-auto grid max-w-[1440px] gap-10 px-4 pb-12 pt-14 sm:px-6 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-end lg:px-8 lg:pb-16">
          <motion.div initial={reduceMotion ? false : "hidden"} animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}>
            <motion.p variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} className="text-sm font-medium text-primary">药妆店价格，一眼看清</motion.p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">{["扫码找同款，", "实时比门店。"].map((line) => <motion.span key={line} variants={{ hidden: { opacity: 0, y: 32 }, show: { opacity: 1, y: 0 } }} className="block">{line}</motion.span>)}</h1>
            <motion.p variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">输入商品名或扫描 JAN 码，快速查看同款商品与附近门店价格。</motion.p>
          </motion.div>

          <motion.div initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="rounded-2xl border bg-card p-3 shadow-[0_24px_80px_oklch(0.2_0.03_240_/_0.08)]">
            <label htmlFor="product-search" className="mb-2 block px-2 text-sm font-medium">找药妆商品</label>
            <div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名、品牌或 JAN 码" className="h-14 border-0 bg-muted pl-12 pr-12 text-base shadow-none focus-visible:ring-2" />{query && <Button variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2" aria-label="清除搜索"><X /></Button>}</div>
            <div className="mt-3 flex items-center justify-between gap-3 px-2 pb-1 text-xs text-muted-foreground"><span className="flex min-w-0 items-center gap-1.5"><Barcode className="size-3.5 shrink-0" /> {supabaseConfigured ? "商品目录实时更新" : "未配置后台，当前为演示数据"}</span><Button variant="ghost" size="sm" onClick={() => setScanOpen(true)} className="-mr-2 shrink-0 text-primary"><ScanLine /> 扫码检索</Button></div>
          </motion.div>
        </section>

        <section id="catalog" className="mx-auto max-w-[1440px] px-4 pb-32 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start">
            <aside className="rounded-2xl border bg-card p-4 lg:sticky lg:top-24 lg:p-5">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setFiltersOpen((value) => !value)} className="flex min-h-9 flex-1 items-center gap-2 text-left font-semibold lg:pointer-events-none" aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal className="size-4" /> 筛选与排序 <ChevronDown className={`ml-auto size-4 transition-transform lg:hidden ${filtersOpen ? "rotate-180" : ""}`} /></button>
                {hasFilters && <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw /> 重置</Button>}
              </div>
              <div id="catalog-filters" className={`${filtersOpen ? "block" : "hidden"} lg:block`}>
                <motion.div key={filtersOpen ? "filters-open" : "filters-closed"} initial={reduceMotion ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                <div className="mt-7"><p className="text-sm font-medium">商品分类</p><div className="mt-3 flex flex-wrap gap-2">{segments.map((item) => <Button key={item} variant={segment === item ? "default" : "outline"} size="sm" onClick={() => setSegment(item)} aria-pressed={segment === item} className="max-w-full truncate">{item}</Button>)}</div></div>
                <div className="mt-8"><div className="flex items-center justify-between gap-3"><label htmlFor="budget" className="text-sm font-medium">最高预算</label><span className="font-mono text-sm">{formatPrice(budget[0])}</span></div><Slider id="budget" value={budget} onValueChange={setBudget} min={MIN_PRICE} max={MAX_PRICE} step={100} className="mt-5" /><div className="mt-3 flex justify-between font-mono text-[11px] text-muted-foreground"><span>¥500</span><span>¥3,200</span></div></div>
                <div className="mt-8"><label htmlFor="sort" className="mb-2 block text-sm font-medium">结果排序</label><Select value={sort} onValueChange={setSort}><SelectTrigger id="sort" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="score">后台默认顺序</SelectItem><SelectItem value="price">最低价优先</SelectItem><SelectItem value="unit">单位价优先</SelectItem><SelectItem value="saving">门店差价最大</SelectItem><SelectItem value="distance">离我最近</SelectItem></SelectContent></Select></div>
                <Button variant={locationStatus === "ready" ? "secondary" : "outline"} className="mt-5 w-full justify-start" onClick={locate} disabled={locationStatus === "loading" || locationStatus === "unsupported"}><MapPin /> {locationCopy}</Button>
                <p className="mt-8 border-t pt-5 text-xs leading-relaxed text-muted-foreground">价格仅供比较，不构成用药建议；用药前请咨询药师并阅读说明书。</p>
                </motion.div>
              </div>
            </aside>

            <div aria-busy={catalogLoading}>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">{catalogLoading ? "正在更新目录" : catalogError ? "后台连接异常" : "匹配结果"}</p><AnimatePresence mode="wait" initial={false}><motion.h2 key={catalogLoading ? "loading" : filtered.length} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="mt-1 text-2xl font-semibold tracking-tight" aria-live="polite">{catalogLoading && !catalog.length ? "正在加载商品" : `${filtered.length} 款可比较商品`}</motion.h2></AnimatePresence></div><div className="flex items-center gap-2 text-sm text-muted-foreground"><BadgeJapaneseYen className="size-4" /> 价格按需查询</div></div>
              {catalogError && <div className="mb-5 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{catalogError}</div>}
              {catalogLoading && !catalog.length && <div className="grid gap-5 md:grid-cols-2" aria-hidden="true">{[0, 1].map((item) => <div key={item} className="overflow-hidden rounded-2xl border bg-card"><div className="aspect-[16/10] animate-pulse bg-muted" /><div className="space-y-4 p-5"><div className="h-3 w-20 animate-pulse rounded bg-muted" /><div className="h-6 w-3/4 animate-pulse rounded bg-muted" /><div className="h-16 animate-pulse rounded-xl bg-muted" /></div></div>)}</div>}
              <motion.div layout className="grid gap-5 md:grid-cols-2"><AnimatePresence mode="popLayout">{filtered.map((product, index) => <ProductCard key={product.id} product={product} featured={index === 0} selected={selected.includes(product.id)} selectionFull={selected.length >= MAX_COMPARE} onToggle={toggleProduct} reduceMotion={reduceMotion} location={location} priceLoading={priceLoading[product.id]} priceChecked={priceChecked[product.id]} priceError={priceErrors[product.id]} onLoadPrices={loadPrices} />)}</AnimatePresence></motion.div>
              {!catalogLoading && catalogHasMore && <div className="mt-8 flex justify-center"><Button variant="outline" size="lg" onClick={loadMoreProducts} disabled={catalogLoadingMore}>{catalogLoadingMore && <LoaderCircle className="animate-spin" />}{catalogLoadingMore ? "正在加载" : "加载更多商品"}</Button></div>}
              {!catalogLoading && !filtered.length && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid min-h-80 place-items-center rounded-2xl border border-dashed bg-muted/30 p-8 text-center"><div><Pill className="mx-auto size-8 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">没有符合条件的商品</h3><p className="mt-2 text-sm text-muted-foreground">换商品名、品牌、JAN 码或直接扫码试试。</p><Button className="mt-5" onClick={resetFilters}>清除筛选</Button></div></motion.div>}
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/35"><div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-24"><div><Scale className="size-8 text-primary" /><h2 className="mt-5 text-3xl font-semibold tracking-tight">查询一次，比较清楚。</h2></div><div className="border-y">{[["公开目录", "商品名、品牌和 JAN 码均来自实时商品库。"], ["按需查价", "需要时再查询门店价格，避免无意消耗额度。"], ["附近门店", "授权定位后，结果会优先显示离你更近的门店。"]].map(([title, body], index) => <motion.div key={title} initial={reduceMotion ? false : { opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ delay: index * 0.06, duration: 0.35 }} className="grid gap-2 border-b py-5 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:items-baseline"><h3 className="font-semibold">{title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{body}</p></motion.div>)}</div></div></section>
      </main>

      <AnimatePresence>{selectedProducts.length > 0 && <motion.div initial={reduceMotion ? false : { opacity: 0, y: 80, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 60, scale: 0.97 }} transition={{ type: "spring", stiffness: 220, damping: 24 }} className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-3xl rounded-2xl border bg-popover/92 p-3 shadow-[0_28px_90px_oklch(0.15_0.04_240_/_0.25)] backdrop-blur-xl sm:bottom-5"><div className="flex items-center gap-3"><div className="hidden size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:grid"><Scale className="size-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">比较列 {selectedProducts.length}/{MAX_COMPARE}</p><p className="truncate text-xs text-muted-foreground">{selectedProducts.map(({ name }) => name).join(" / ")}</p></div><Button variant="ghost" size="sm" onClick={() => setSelected([])} className="hidden sm:inline-flex">清空</Button><Button onClick={() => setCompareOpen(true)} disabled={selectedProducts.length < 2}>{selectedProducts.length < 2 ? "再选一款" : "开始比较"}<ChevronRight /></Button></div></motion.div>}</AnimatePresence>

      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} selectedProducts={selectedProducts} onRemove={toggleProduct} />
      <ScannerDialog open={scanOpen} onOpenChange={setScanOpen} onFound={handleScannedProduct} session={session} />
      <LoginDialog open={authOpen} onOpenChange={setAuthOpen} onSignedIn={handleSignedIn} />
    </div>
  )
}
