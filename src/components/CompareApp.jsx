import { readLocation, requestLocation } from "@/lib/location.mjs"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  Pill,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Share2,
  SlidersHorizontal,
  Sun,
  UserRound,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

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
  fetchCommercialOffers,
  fetchPublicCatalogPricePreviews,
  fetchJancodeProductDraft,
  fetchRakutenProductDraft,
  fetchProductByBarcode,
  fetchProductById,
  friendlyApiError,
  getSession,
  mapProductRow,
  offersFromPriceRows,
  recordTelemetryEvent,
  recordCommercialClick,
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
  getBasketSummary,
  getBestSingleStoreBasket,
  getClosestOffer,
  getCompareSelectionFromSearch,
  getImageSrcSet,
  getMapUrl,
  getPriceStats,
  MAX_COMPARE,
  MAX_PRICE,
  MIN_PRICE,
  products as demoProducts,
  sanitizeCompareSelection,
  sanitizePriceSnapshots,
} from "@/lib/products.mjs"
import { appPath } from "@/lib/paths.mjs"
import { CATALOG_STATE_KEY, readCatalogState } from "@/lib/catalog-state.mjs"
import { getCatalogCategory } from "@/lib/catalog-category.mjs"

const formatDate = (value) => {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date) : "日期未知"
}

const comparisonRows = [
  ["最低价", (product) => product.offers.length ? formatPrice(getPriceStats(product).min) : product.pricePreview ? `近期 ${formatPrice(product.pricePreview.minPrice)}` : null],
  ["单位价格", (product) => product.offers.length && product.pack !== "规格未登记" ? formatUnitPrice(product) : null],
  ["最低价来源", (product) => getPriceStats(product).bestOffer?.name || null],
  ["规格", (product) => product.pack !== "规格未登记" ? product.pack : null],
  ["报价更新", (product) => {
    const date = getPriceStats(product).bestOffer?.sampledAt || product.pricePreview?.latestCollectedAt
    return date ? formatDate(date) : null
  }],
  ["价格条件", (product) => getPriceStats(product).bestOffer?.member ? "会员价" : product.offers.length ? "普通价" : null],
]
const COMPARE_SELECTION_KEY = "aprice:compare-selection"
const COMPARE_PRICE_KEY = "aprice:compare-price-snapshots"

function ThemeButton() {
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark")
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="切换颜色模式">
      <Moon className="dark:hidden" /><Sun className="hidden dark:block" />
    </Button>
  )
}

function ScannerDialog({ open, onOpenChange, onFound, session }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const [manualCode, setManualCode] = useState("")
  const [status, setStatus] = useState("")
  const [scanning, setScanning] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
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
    if (lookingUp) return
    setLookingUp(true)
    setDraft(null)
    setStatus(`正在查询 ${barcode}…`)
    try {
      const row = supabaseConfigured
        ? await fetchProductByBarcode(barcode)
        : demoProducts.find((product) => product.barcode === barcode)
      if (!row) {
        setStatus(`后台没有找到 JAN ${barcode}，正在尝试补全商品信息…`)
        const external = await fetchJancodeProductDraft(barcode).catch(() => null)
          || await fetchRakutenProductDraft(barcode).catch(() => null)
        setDraft(external || { id: barcode, barcode, name: "", brand: "", pack: "", category: "", tone: "sunset", description: "", image_url: "" })
        setStatus(external ? (external.source_url ? "已从乐天预填，请确认后提交审核。" : "已从 JANCODE 预填，请确认后提交审核。") : "JANCODE 和乐天都没有记录，请手动填写后提交审核。")
        return
      }
      stopCamera()
      onFound(supabaseConfigured ? mapProductRow(row) : row)
    } catch (error) {
      setStatus(friendlyApiError(error))
    } finally { setLookingUp(false) }
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
      <DialogContent className="flex max-h-[90dvh] max-w-[min(560px,calc(100vw-2rem))] flex-col overflow-y-auto sm:max-w-xl [&>*]:shrink-0" onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("product-search")?.focus() }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="size-5 text-primary" /> 扫码检索</DialogTitle>
          <DialogDescription>启动相机扫描条码，或手动输入 JAN 码。</DialogDescription>
        </DialogHeader>
        <div className={`relative overflow-hidden rounded-xl border bg-slate-950 ${scanning ? "h-[min(36dvh,260px)]" : "h-32"}`}>
          <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" aria-label="条码扫描相机预览" />
          {scanning && <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 bg-primary" />}
          {!scanning && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80"><Camera className="size-7" />相机尚未启动</div>}
        </div>
        {scanning ? <Button variant="outline" onClick={stopCamera}><Camera /> 停止相机</Button> : <Button onClick={startCamera}><Camera /> 启动相机</Button>}
        <form onSubmit={(event) => { event.preventDefault(); lookup(manualCode) }}>
          <label htmlFor="manual-jan" className="mb-2 block text-sm font-medium">手动输入 JAN 码</label>
          <div className="flex gap-2"><Input id="manual-jan" value={manualCode} onChange={(event) => setManualCode(event.target.value)} inputMode="numeric" placeholder="例如 4901234567894" disabled={lookingUp} /><Button type="submit" variant="secondary" disabled={lookingUp}>{lookingUp && <LoaderCircle className="animate-spin" />}{lookingUp ? "查询中" : "查询"}</Button></div>
        </form>
        <p className="text-sm text-muted-foreground empty:hidden" role="status" aria-live="polite">{status}</p>
        {draft && <form className="space-y-3 rounded-2xl border bg-muted/35 p-4" onSubmit={submitMissing}>
          <div><p className="font-medium">补录缺失商品</p><p className="mt-1 text-xs text-muted-foreground">JAN {draft.barcode} · 提交后由管理员审核</p></div>
          <label className="block"><span className="mb-2 block text-sm font-medium">商品名称</span><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground marker:text-muted-foreground">补充品牌与规格（可选）</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-sm font-medium">品牌</span><Input value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label><label className="block"><span className="mb-2 block text-sm font-medium">规格</span><Input value={draft.pack} onChange={(event) => setDraft({ ...draft, pack: event.target.value })} placeholder="例如 30 片" /></label></div>
          </details>
          {session ? <Button type="submit" className="w-full" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <Plus />}{submitting ? "正在提交" : "提交审核"}</Button> : <Button asChild className="w-full"><a href={appPath(`/login/?redirect=${encodeURIComponent(appPath(`/scan/?jan=${draft.barcode}`))}`)}><LogIn /> 登录后提交</a></Button>}
        </form>}
      </DialogContent>
    </Dialog>
  )
}

function LoginDialog({ open, onOpenChange, onSignedIn, priceIntent = false }) {
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [returnPath, setReturnPath] = useState(appPath("/"))

  useEffect(() => {
    setReturnPath(`${window.location.pathname}${window.location.search}`)
  }, [])

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

  const authHref = (mode) => appPath(`/login/?mode=${mode}&redirect=${encodeURIComponent(returnPath)}`)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(440px,calc(100vw-2rem))] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{priceIntent ? "登录后继续查价" : "登录 LOWPRICE"}</DialogTitle>
          <DialogDescription>{priceIntent ? "登录后将自动继续查询价格，当前比价清单不会丢失。" : "登录后可查询价格、收藏商品并查看个人记录。"}</DialogDescription>
        </DialogHeader>
        <form className="mt-2 space-y-3" onSubmit={submit}>
          <label className="block"><span className="mb-2 block text-sm font-medium">邮箱</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium">密码</span><span className="relative block"><Input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="pr-12" /><Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowPassword((value) => !value)} className="absolute right-0 top-1/2 -translate-y-1/2" aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff /> : <Eye />}</Button></span></label>
          {turnstileEnabled && <div ref={turnstileRef} className="min-h-[65px]" aria-label="人机验证" />}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" /> : <LogIn />}{loading ? "正在登录" : priceIntent ? "登录并继续查价" : "登录"}
          </Button>
          <div className="flex items-center justify-between gap-3 text-sm">
            <a className="rounded-md px-1 py-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={authHref("register")}>注册账号</a>
            <a className="rounded-md px-1 py-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={authHref("resetRequest")}>忘记密码</a>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductCard({ product, featured, selected, selectionFull, onToggle, reduceMotion, location, priceLoading, priceChecked, priceError, onLoadPrices, session }) {
  const stats = getPriceStats(product)
  const closest = getClosestOffer(product, location)
  const preview = product.pricePreview
  const hasPrices = stats.storeCount > 0 || Boolean(preview)
  const sourceCount = stats.storeCount || preview?.storeCount || 0
  const minimumPrice = stats.storeCount ? stats.min : preview?.minPrice
  const sampledAt = stats.bestOffer?.sampledAt || preview?.latestCollectedAt
  const pack = product.pack !== "规格未登记" ? product.pack : ""

  return (
    <motion.article layout initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.2 }} className="group min-w-0 overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-sm">
      <div className="grid h-full grid-cols-[88px_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4 sm:p-4">
        <a href={appPath('/product/?id=' + encodeURIComponent(product.id))} aria-label={'查看 ' + product.name + ' 详情'} className="relative block aspect-square overflow-hidden rounded-lg bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <img src={product.image} srcSet={getImageSrcSet(product.image)} sizes="(min-width: 640px) 120px, 88px" width="120" height="120" alt={product.name} loading={featured ? "eager" : "lazy"} fetchPriority={featured ? "high" : "auto"} decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.src = "/lowprice-logo.png"; event.currentTarget.srcset = "" }} className="absolute inset-0 h-full w-full object-contain p-2" />
        </a>
        <div className="flex min-w-0 flex-col">
          {product.maker !== "品牌未登记" && <p className="truncate text-xs text-muted-foreground">{product.maker}</p>}
          <h3 className="mt-1 font-semibold leading-snug"><a href={appPath('/product/?id=' + encodeURIComponent(product.id))} className="inline-flex min-h-11 items-center outline-none hover:text-primary focus-visible:ring-2"><span className="line-clamp-2">{product.name}</span></a></h3>
          {pack && <p className="mt-1 text-sm text-muted-foreground">{pack}</p>}
          <div className="mt-3">
            {hasPrices ? <><p className="font-mono text-2xl font-semibold tracking-tight text-primary">{formatPrice(minimumPrice)}{stats.bestOffer?.member && <span className="ml-2 font-sans text-xs font-normal">会员价</span>}</p><p className="mt-1 text-xs text-muted-foreground">{stats.bestOffer ? stats.bestOffer.name : '近期最低价（仅供参考） · ' + sourceCount + ' 个来源'} · {formatDate(sampledAt)}</p></> : <p className="text-sm text-muted-foreground">{priceLoading ? "正在查询报价…" : priceError || (priceChecked ? "暂无近期报价" : "尚未查价")}</p>}
            {closest && <p className="mt-1 text-xs text-muted-foreground">最近 {closest.name} · {formatDistance(closest.distance)}</p>}
            {/軽減税率/.test(product.category) && <p className="mt-1 text-xs text-muted-foreground">来源标注：轻减税率</p>}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-3">
            <Button asChild variant="ghost" className="px-2.5"><a href={appPath('/product/?id=' + encodeURIComponent(product.id))}>详情<ChevronRight /></a></Button>
            {hasPrices ? <Button variant={selected ? "default" : "outline"} onClick={() => onToggle(product.id)} disabled={!selected && selectionFull} aria-pressed={selected}>{selected ? <Check /> : <Plus />}{selected ? "已加入" : selectionFull ? "清单已满" : "加入清单"}</Button> : <Button onClick={() => onLoadPrices(product.id)} disabled={priceLoading}>{priceLoading && <LoaderCircle className="animate-spin" />}{priceLoading ? "查询中" : !session && supabaseConfigured ? "登录查价" : priceChecked ? "重新查询" : "查询报价"}</Button>}
          </div>
          {!selected && selectionFull && <p className="mt-2 text-xs text-muted-foreground">清单最多 {MAX_COMPARE} 件，请先移除一件。</p>}
        </div>
      </div>
    </motion.article>
  )
}

function CompareDialog({ open, onOpenChange, selectedProducts, commercialOffers, onCommercial, onRemove, onLoadPrices, priceLoading, priceChecked, priceErrors, session, onClear }) {
  const [shareStatus, setShareStatus] = useState("")
  const [commercialStatus, setCommercialStatus] = useState("")
  const summary = getBasketSummary(selectedProducts)
  const singleStore = getBestSingleStoreBasket(selectedProducts)
  const visibleRows = comparisonRows.filter(([, value]) => selectedProducts.some((product) => value(product)))

  const shareList = async () => {
    const url = new URL(appPath("/"), window.location.origin)
    url.searchParams.set("compare", selectedProducts.map(({ id }) => id).join(","))
    const names = selectedProducts.slice(0, 3).map(({ name }) => name).join("、")
    const more = selectedProducts.length > 3 ? `等 ${selectedProducts.length} 件商品` : ""
    const total = summary.pricedCount ? `，逐件最低合计 ${formatPrice(summary.minimumTotal)}` : ""
    const text = `${names}${more}${total}`
    try {
      const shareMethod = navigator.share ? "native" : "clipboard"
      if (navigator.share) {
        await navigator.share({ title: "APrice 比价清单", text, url: url.href })
        setShareStatus("已分享")
      } else {
        await navigator.clipboard.writeText(url.href)
        setShareStatus("链接已复制")
      }
      void recordTelemetryEvent("compare_list_shared", { item_count: selectedProducts.length, priced_count: summary.pricedCount, share_method: shareMethod }).catch(() => {})
    } catch (error) {
      if (error?.name !== "AbortError") setShareStatus("分享失败，请重试")
    }
  }

  const openCommercial = async (offer) => {
    setCommercialStatus("正在记录并前往合作商店…")
    try { await onCommercial(offer) } catch (error) { setCommercialStatus(friendlyApiError(error)) }
  }

  const productActions = (product) => {
    const commercialOffer = commercialOffers.find((offer) => String(offer.product_id) === String(product.id))
    return <><div className="mt-3 flex flex-wrap gap-2">
      {!product.offers.length && supabaseConfigured && <Button variant="outline" size="sm" onClick={() => onLoadPrices(product.id)} disabled={priceLoading[product.id]}>{priceLoading[product.id] && <LoaderCircle className="animate-spin" />}{priceLoading[product.id] ? "查询中" : !session ? "登录查价" : priceChecked[product.id] ? "重新查询" : "查询报价"}</Button>}
      {commercialOffer && <Button variant="ghost" size="sm" onClick={() => openCommercial(commercialOffer)}>合作购买</Button>}
      <Button asChild variant="ghost" size="sm"><a href={appPath(`/product/?id=${encodeURIComponent(product.id)}`)}>商品详情</a></Button>
    </div>{!product.offers.length && <p className="mt-2 text-xs text-muted-foreground" role="status">{priceLoading[product.id] ? "正在查询报价…" : priceErrors[product.id] || (priceChecked[product.id] ? "暂无近期报价" : product.pricePreview ? "近期价格仅供参考，查价后计入合计。" : "尚未查价")}</p>}</>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`flex max-h-[90dvh] flex-col overflow-hidden p-0 ${selectedProducts.length <= 1 ? "sm:max-w-xl" : "sm:max-w-5xl"}`} onCloseAutoFocus={(event) => { event.preventDefault(); (document.getElementById("view-compare") || document.getElementById("product-search"))?.focus() }}>
        <DialogHeader className="border-b px-6 py-5 text-left"><div className="flex items-start justify-between gap-4 pr-8"><div><DialogTitle className="text-xl">比价清单</DialogTitle><DialogDescription className="mt-1">报价来自近期价格库，合计仅统计已查价商品。</DialogDescription>{(shareStatus || commercialStatus) && <p className="mt-2 text-xs text-muted-foreground" role="status">{commercialStatus || shareStatus}</p>}</div><Button className="shrink-0" variant="outline" size="sm" onClick={shareList} disabled={!selectedProducts.length}><Share2 />分享</Button></div>{summary.pricedCount > 0 && <div className="flex flex-wrap gap-x-8 gap-y-3 pt-3"><div><p className="text-xs text-muted-foreground">逐件最低合计</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{formatPrice(summary.minimumTotal)}</p></div><div><p className="text-xs text-muted-foreground">可见差价合计</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{formatPrice(summary.visibleSaving)}</p></div>{selectedProducts.length > 1 && singleStore && <div><p className="text-xs text-muted-foreground">一店购最低</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{formatPrice(singleStore.total)}</p><p className="mt-1 max-w-48 truncate text-xs text-muted-foreground">{singleStore.name} · 多 {formatPrice(singleStore.premium)}{singleStore.includesMemberPrice && " · 含会员价"}</p><Button asChild variant="link" size="sm" className="-ml-3 mt-1"><a href={getMapUrl(singleStore)} target="_blank" rel="noreferrer" onClick={() => void recordTelemetryEvent("map_opened", { source: "compare_list", store_id: singleStore.id, item_count: selectedProducts.length }).catch(() => {})}><MapPin />地图查看</a></Button></div>}<p className="self-end text-xs text-muted-foreground">已查价 {summary.pricedCount}/{summary.totalCount} 件{selectedProducts.length > 1 && !singleStore && (summary.pricedCount < summary.totalCount ? " · 全部查价后计算一店购" : " · 暂无共同实体店")}</p></div>}</DialogHeader>
        <div className="min-h-0 overflow-auto px-4 pb-6 sm:px-6">
          {!selectedProducts.length && <div className="py-8 text-center"><p className="text-sm text-muted-foreground">清单已清空，继续添加想比较的商品。</p><Button variant="outline" className="mt-4" onClick={() => onOpenChange(false)}>继续选商品</Button></div>}
          <div className={selectedProducts.length <= 1 ? "divide-y" : "divide-y md:hidden"}>{selectedProducts.map((product) => <article key={product.id} className="py-5">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs text-muted-foreground">{product.maker}</p><h3 className="mt-1 break-words font-semibold">{product.name}</h3></div><Button variant="ghost" size="icon-sm" onClick={() => onRemove(product.id)} aria-label={`移除 ${product.name}`}><X /></Button></div>
            <dl className="mt-4 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">{comparisonRows.filter(([, value]) => value(product)).map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value(product)}</dd></div>)}</dl>
            {productActions(product)}
          </article>)}</div>
          {selectedProducts.length > 1 && <div className="hidden min-w-[640px] md:grid" style={{ gridTemplateColumns: `110px repeat(${selectedProducts.length}, minmax(220px, 1fr))` }}>
            <div className="sticky left-0 z-10 bg-popover py-5" />
            {selectedProducts.map((product) => {
              return <div key={product.id} className="border-b px-4 py-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{product.maker}</p><p className="mt-1 font-semibold">{product.name}</p></div><Button variant="ghost" size="icon-sm" onClick={() => onRemove(product.id)} aria-label={`移除 ${product.name}`}><X /></Button></div>{productActions(product)}</div>
            })}
            {visibleRows.flatMap(([label, value]) => [
              <div key={`${label}-label`} className="sticky left-0 z-10 border-b bg-popover py-4 text-sm text-muted-foreground">{label}</div>,
              ...selectedProducts.map((product) => <div key={`${label}-${product.id}`} className="border-b px-4 py-4 text-sm font-medium">{value(product) || "—"}</div>),
            ])}
          </div>}
          {selectedProducts.length > 0 && <div className="mt-4 flex justify-end border-t pt-3"><Button variant="ghost" size="sm" onClick={onClear}>清空清单</Button></div>}
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
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [catalogReady, setCatalogReady] = useState(false)
  const restoredQuery = useRef(null)
  const pendingScroll = useRef(null)
  const catalogView = useRef(null)
  const [query, setQuery] = useState("")
  const [segment, setSegment] = useState("全部")
  const [brand, setBrand] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [budget, setBudget] = useState([MAX_PRICE])
  const [sort, setSort] = useState("score")
  const [selected, setSelected] = useState([])
  const [savedProducts, setSavedProducts] = useState([])
  const [selectionReady, setSelectionReady] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [pendingPriceId, setPendingPriceId] = useState("")
  const [reopenCompareAfterAuth, setReopenCompareAfterAuth] = useState(false)
  const [priceLoading, setPriceLoading] = useState({})
  const [priceChecked, setPriceChecked] = useState({})
  const [priceErrors, setPriceErrors] = useState({})
  const [commercialOffers, setCommercialOffers] = useState([])
  const [location, setLocation] = useState(readLocation)
  const [locationStatus, setLocationStatus] = useState(() => readLocation() ? "ready" : "idle")
  const [locationError, setLocationError] = useState("")

  useEffect(() => { if (initialScan) setScanOpen(true) }, [initialScan])

  catalogView.current = { catalog, query, segment, brand, budget: budget[0], sort, filtersOpen, hasMore: catalogHasMore, userId: session?.user.id || null, location, loading: catalogLoading }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const returning = params.get("restore") === "1" || performance.getEntriesByType("navigation")[0]?.type === "back_forward"
    let saved = null
    try { if (returning && !initialScan) saved = readCatalogState(sessionStorage.getItem(CATALOG_STATE_KEY)) } catch {}
    let active = true
    const restore = async () => {
      if (saved?.userId) {
        const current = await getSession().catch(() => null)
        if (current?.user.id !== saved.userId) saved = null
        else if (active) setSession(current)
      }
      if (!active) return
      if (saved) {
        setCatalog(saved.catalog)
        setQuery(saved.query)
        setSegment(saved.segment)
        setBrand(saved.brand)
        setBudget([Math.max(MIN_PRICE, Math.min(MAX_PRICE, saved.budget))])
        setSort(saved.sort)
        const currentLocation = readLocation()
        setLocation(currentLocation)
        setLocationStatus(currentLocation ? "ready" : "idle")
        setFiltersOpen(saved.filtersOpen)
        setCatalogHasMore(saved.hasMore)
        setCatalogLoading(false)
        restoredQuery.current = saved.query
        pendingScroll.current = saved.scrollY
      }
      if (params.has("restore")) {
        const url = new URL(window.location.href)
        url.searchParams.delete("restore")
        history.replaceState(null, "", url.href)
      }
      setCatalogReady(true)
    }
    void restore()
    const saveView = () => {
      try {
        const view = catalogView.current
        if (!initialScan && !view.loading && view.catalog.length) sessionStorage.setItem(CATALOG_STATE_KEY, JSON.stringify({ ...view, scrollY: window.scrollY, savedAt: Date.now() }))
      } catch {}
    }
    window.addEventListener("pagehide", saveView)
    return () => { active = false; window.removeEventListener("pagehide", saveView) }
  }, [initialScan])

  useEffect(() => {
    if (!catalogReady || pendingScroll.current === null) return
    const y = pendingScroll.current
    pendingScroll.current = null
    const frame = requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }))
    return () => cancelAnimationFrame(frame)
  }, [catalogReady])

  useEffect(() => {
    let active = true
    let saved = []
    let snapshots = {}
    try { saved = sanitizeCompareSelection(JSON.parse(localStorage.getItem(COMPARE_SELECTION_KEY) || "[]")) } catch {}
    try { snapshots = sanitizePriceSnapshots(JSON.parse(localStorage.getItem(COMPARE_PRICE_KEY) || "{}")) } catch {}
    const shared = getCompareSelectionFromSearch(window.location.search)
    const compareSource = new URLSearchParams(window.location.search).get("compare_source")
    const ids = shared.length ? shared : saved
    if (shared.length) {
      const url = new URL(window.location.href)
      url.searchParams.delete("compare")
      url.searchParams.delete("compare_source")
      history.replaceState(null, "", url.href)
    }
    setSelected(ids)
    setSelectionReady(true)
    if (ids.length) {
      const loadSaved = supabaseConfigured
        ? Promise.all(ids.map((id) => fetchProductById(id).catch(() => null))).then((rows) => rows.filter(Boolean).map(mapProductRow))
        : Promise.resolve(demoProducts.filter(({ id }) => ids.includes(id)))
      loadSaved.then((rows) => {
        if (!active) return
        setSavedProducts(rows.map((product) => snapshots[product.id] ? { ...product, offers: snapshots[product.id].offers } : product))
        const sharedCount = shared.filter((id) => rows.some((row) => row.id === id)).length
        if (sharedCount) {
          setCompareOpen(true)
          if (!compareSource) void recordTelemetryEvent("compare_list_opened", { item_count: sharedCount }).catch(() => {})
        }
      })
    }
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectionReady) return
    try { localStorage.setItem(COMPARE_SELECTION_KEY, JSON.stringify(sanitizeCompareSelection(selected))) } catch {}
    if (!selected.length) { setCommercialOffers([]); return }
    fetchCommercialOffers(selected).then((offers) => {
      setCommercialOffers(offers)
      if (offers.length) void recordTelemetryEvent("commercial_offer_seen", { offer_count: offers.length, source: "compare" }).catch(() => {})
    }).catch(() => setCommercialOffers([]))
  }, [selected, selectionReady])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let active = true
    let unsubscribe = () => {}
    getSession().then((value) => { if (active) setSession(value) }).catch(() => {})
    subscribeAuthState((value) => { if (active) setSession(value) }).then((stop) => { unsubscribe = stop }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabaseConfigured || !catalogReady) return undefined
    if (restoredQuery.current === query) { restoredQuery.current = null; return undefined }
    let active = true
    const timer = setTimeout(async () => {
      setCatalogLoading(true)
      setCatalogError("")
      try {
        const rows = await searchProducts(query)
        void recordTelemetryEvent("search_completed", { query_present: Boolean(query.trim()), result_count: rows.length }).catch(() => {})
        if (active) {
          const products = rows.map(mapProductRow)
          const previews = await fetchPublicCatalogPricePreviews(products.map(({ id }) => id)).catch(() => ({}))
          if (!active) return
          setCatalog(products.map((product) => previews[product.id] ? { ...product, pricePreview: previews[product.id] } : product))
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
  }, [query, catalogRetry, catalogReady])

  const segments = useMemo(() => ["全部", ...new Set(catalog.map(getCatalogCategory))], [catalog])
  const brands = useMemo(() => [...new Set(catalog.map(({ maker }) => maker).filter((maker) => maker && maker !== "品牌未登记"))].toSorted(), [catalog])
  useEffect(() => { if (!catalogLoading && !catalogError && !segments.includes(segment)) setSegment("全部") }, [segments, segment, catalogLoading, catalogError])
  useEffect(() => { if (!catalogLoading && !catalogError && brand && !brands.includes(brand)) setBrand("") }, [brands, brand, catalogLoading, catalogError])
  const hasCatalogPrices = catalog.some((product) => product.offers.length > 0)
  const hasUnitPrices = catalog.some((product) => product.offers.length && product.pack !== "规格未登记")
  const hasPriceDifferences = catalog.some((product) => product.offers.length > 1)
  const hasStoreDistances = Boolean(location) && catalog.some((product) => getClosestOffer(product, location))
  useEffect(() => {
    if ((sort === "unit" && !hasUnitPrices) || (sort === "saving" && !hasPriceDifferences) || (sort === "distance" && !hasStoreDistances)) setSort("score")
  }, [sort, hasUnitPrices, hasPriceDifferences, hasStoreDistances])
  useEffect(() => {
    if (!catalogLoading && !catalogError && !hasCatalogPrices) {
      setBudget([MAX_PRICE])
      setSort("score")
    }
  }, [hasCatalogPrices, catalogLoading, catalogError])

  const filtered = useMemo(() => filterProducts(catalog, { query: supabaseConfigured ? "" : query, segment, brand, maxPrice: budget[0] === MAX_PRICE ? Infinity : budget[0], sort, location }), [catalog, query, segment, brand, budget, sort, location])
  const selectedProducts = selected.map((id) => {
    const current = catalog.find((product) => product.id === id)
    const saved = savedProducts.find((product) => product.id === id)
    return saved?.offers.length ? saved : current || saved
  }).filter(Boolean)
  const hasFilters = query || segment !== "全部" || brand || budget[0] !== MAX_PRICE || sort !== "score"

  const toggleProduct = (id) => {
    const product = catalog.find((item) => item.id === id)
    if (product && !selected.includes(id) && selected.length < MAX_COMPARE) {
      setSavedProducts((items) => items.some((item) => item.id === id) ? items : [...items.filter((item) => selected.includes(item.id)), product])
    }
    setSelected((current) => current.includes(id) ? current.filter((productId) => productId !== id) : current.length < MAX_COMPARE ? [...current, id] : current)
  }

  const resetFilters = () => {
    setQuery("")
    setSegment("全部")
    setBrand("")
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
      void recordTelemetryEvent(offers.length ? "price_query_succeeded" : "price_query_empty", { product_id: id, offer_count: offers.length, has_location: Boolean(location) }).catch(() => {})
      if (selected.length > 1 && selected.every((productId) => productId === id || priceChecked[productId])) {
        void recordTelemetryEvent("compare_completed", { item_count: selected.length }).catch(() => {})
      }
      setCatalog((items) => items.map((product) => product.id === id ? { ...product, offers } : product))
      setSavedProducts((items) => items.map((product) => product.id === id ? { ...product, offers } : product))
      try {
        const snapshots = sanitizePriceSnapshots(JSON.parse(localStorage.getItem(COMPARE_PRICE_KEY) || "{}"))
        const entries = Object.entries(snapshots).filter(([productId]) => productId !== String(id))
        if (offers.length) entries.push([String(id), { savedAt: Date.now(), offers }])
        localStorage.setItem(COMPARE_PRICE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_COMPARE))))
      } catch {}
      setPriceChecked((value) => ({ ...value, [id]: true }))
    } catch (error) {
      setPriceErrors((value) => ({ ...value, [id]: friendlyApiError(error) }))
    } finally {
      setPriceLoading((value) => ({ ...value, [id]: false }))
    }
  }

  const openCommercialOffer = async (offer) => {
    window.location.assign(await recordCommercialClick(offer.id, "compare"))
  }

  const handleSignedIn = async (nextSession) => {
    setSession(nextSession)
    setAuthOpen(false)
    const id = pendingPriceId
    setPendingPriceId("")
    if (id) await loadPrices(id, nextSession?.access_token)
    if (reopenCompareAfterAuth) {
      setReopenCompareAfterAuth(false)
      setCompareOpen(true)
    }
  }

  const loadComparePrices = (id) => {
    if (!session) {
      setCompareOpen(false)
      setReopenCompareAfterAuth(true)
    }
    void loadPrices(id)
  }

  const handleAuthOpenChange = (open) => {
    setAuthOpen(open)
    if (!open && !session) {
      setPendingPriceId("")
      if (reopenCompareAfterAuth) setCompareOpen(true)
      setReopenCompareAfterAuth(false)
    }
  }

  const loadMoreProducts = async () => {
    setCatalogLoadingMore(true)
    setCatalogError("")
    try {
      const rows = await searchProducts(query, 30, { offset: catalog.length })
      const products = rows.map(mapProductRow)
      const previews = await fetchPublicCatalogPricePreviews(products.map(({ id }) => id)).catch(() => ({}))
      setCatalog((items) => [...items, ...products.map((product) => previews[product.id] ? { ...product, pricePreview: previews[product.id] } : product).filter((row) => !items.some((item) => item.id === row.id))])
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
    try { sessionStorage.removeItem(CATALOG_STATE_KEY) } catch {}
    setCatalog((items) => items.map((product) => ({ ...product, offers: [] })))
  }

  const handleScannedProduct = (product) => {
    if (supabaseConfigured) {
      setScanOpen(false)
      window.location.assign(appPath(`/product/?id=${encodeURIComponent(product.id)}`))
      return
    }
    setCatalog(demoProducts)
    setQuery(product.barcode)
    setSegment("全部")
    setBrand("")
    setScanOpen(false)
  }

  const locate = async () => {
    if (locationStatus === "loading") return
    setLocationStatus("loading")
    setLocationError("")
    try {
      setLocation(await requestLocation())
      setLocationStatus("ready")
      setSort("distance")
    } catch (error) { setLocationStatus("error"); setLocationError(error.message) }
  }

  const locationCopy = { idle: "获取当前位置", loading: "正在定位…", ready: "更新当前位置", error: "重新定位" }[locationStatus]

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href={appPath("/")} className="flex min-h-11 items-center gap-3" aria-label="LOWPRICE 首页"><img src="/lowprice-logo.png" alt="LOWPRICE" className="h-11 w-auto object-contain" /></a>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" className="hidden sm:inline-flex"><a href="#catalog">商品比价</a></Button>
            <Button asChild variant="ghost" className="size-11 px-0 sm:w-auto sm:px-2.5 md:h-9"><a href={appPath("/scan/")} aria-label="扫码检索"><ScanLine /><span className="hidden sm:inline">扫码</span></a></Button>
            {session && <Button asChild variant="ghost" className="size-11 px-0 sm:w-auto sm:px-2.5 md:h-9"><a href={appPath("/me/")} aria-label="我的账户"><UserRound /><span className="hidden sm:inline">我的</span></a></Button>}
            {supabaseConfigured && (session ? <Button variant="ghost" size="sm" onClick={handleSignOut} className="size-11 px-0 sm:w-auto sm:px-2.5 md:h-9" aria-label="退出登录"><LogOut /><span className="hidden sm:inline">退出</span></Button> : <Button variant="ghost" size="sm" onClick={() => setAuthOpen(true)} className="size-11 px-0 sm:w-auto sm:px-2.5 md:h-9" aria-label="登录"><LogIn /><span className="hidden sm:inline">登录</span></Button>)}
            <ThemeButton />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="mx-auto max-w-6xl px-4 pb-5 pt-6 sm:px-6 md:pt-8 lg:px-8">
          <motion.div initial={reduceMotion ? false : "hidden"} animate="visible" variants={{ visible: { transition: { staggerChildren: 0.07 } } }}>
            <motion.h1 variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.48, ease: [0.16, 1, 0.3, 1] } } }} className="max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">搜商品，直接比价。</motion.h1>
            <motion.div variants={{ hidden: { opacity: 0, y: 12, scale: 0.99 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.46, ease: [0.16, 1, 0.3, 1] } } }} className="search-shell mt-4 flex gap-2 rounded-2xl border bg-card p-2 shadow-[0_20px_60px_oklch(0.2_0.03_240_/_0.07)]">
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名、品牌或 JAN 码" aria-label="搜索商品" className="h-12 border-0 bg-transparent px-12 text-base shadow-none focus-visible:ring-0" />{query && <Button variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2" aria-label="清除搜索"><X /></Button>}</div>
              <Button size="lg" onClick={() => setScanOpen(true)} aria-label="扫码检索" className="h-12 shrink-0 px-4 sm:px-6"><ScanLine /><span className="hidden sm:inline">扫码</span></Button>
            </motion.div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={locate} disabled={locationStatus === "loading"}><MapPin />{locationCopy}</Button>
              <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{locationError || (location ? "已获取位置，实体门店按距离比较。" : "尚未定位，报价门店可能不在你附近。")}</p>
            </div>
          </motion.div>
        </section>

        <section id="catalog" className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 lg:px-8">
          <div>
            <div className="mb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="mr-auto text-lg font-semibold" aria-live="polite">{catalogLoading ? "正在加载商品" : catalogError ? "商品加载失败" : filtered.length + " 款商品"}</h2>
                <button type="button" onClick={() => setFiltersOpen((value) => !value)} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal className="size-4" /> 筛选与排序{hasFilters ? ` · ${[segment !== "全部", Boolean(brand), budget[0] !== MAX_PRICE, sort !== "score"].filter(Boolean).length}` : ""} <ChevronDown className={`ml-auto size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} /></button>
                {hasFilters && <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw /> 重置</Button>}
              </div>
              <AnimatePresence initial={false}>
                {filtersOpen && <motion.div id="catalog-filters" initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduceMotion ? undefined : { opacity: 0, height: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                <div className={`mt-4 grid gap-5 border-t pt-5 ${hasCatalogPrices ? "md:grid-cols-[1.3fr_1fr_0.9fr]" : "md:grid-cols-[1.3fr_1fr]"}`}>
                  <div><p className="text-sm font-medium">商品分类 <span className="font-normal text-muted-foreground">· 当前已加载商品</span></p><div className="mt-3 flex flex-wrap gap-2">{segments.map((item) => <Button key={item} variant={segment === item ? "default" : "outline"} size="sm" onClick={() => setSegment(item)} aria-pressed={segment === item} className="max-w-full truncate">{item}</Button>)}</div><label className="mt-4 block text-sm font-medium" htmlFor="brand-filter">品牌 / 厂商</label><select id="brand-filter" className="mt-2 h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">全部品牌 / 厂商</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
                  {hasCatalogPrices ? <><div><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">最高预算</span><span className="font-mono text-sm">{budget[0] === MAX_PRICE ? "不限" : formatPrice(budget[0])}</span></div><Slider aria-label="最高预算" value={budget} onValueChange={setBudget} min={MIN_PRICE} max={MAX_PRICE} step={100} className="mt-5" /></div>
                  <div><label htmlFor="sort" className="mb-2 block text-sm font-medium">结果排序</label><Select value={sort} onValueChange={setSort}><SelectTrigger id="sort" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="score">默认顺序</SelectItem><SelectItem value="price">最低价优先</SelectItem>{hasUnitPrices && <SelectItem value="unit">单位价优先</SelectItem>}{hasPriceDifferences && <SelectItem value="saving">差价最大</SelectItem>}{hasStoreDistances && <SelectItem value="distance">离我最近</SelectItem>}</SelectContent></Select><p className="mt-2 text-xs text-muted-foreground">价格排序仅使用已查询报价。</p></div></> : <p className="text-sm text-muted-foreground">价格筛选将在查价后启用。</p>}
                </div>
                </motion.div>}
              </AnimatePresence>
            </div>

            <div aria-busy={catalogLoading}>
              {catalogError && <div className="mb-5 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-4 text-sm" role="alert"><p className="font-semibold">商品目录暂时无法加载</p><p className="mt-1 text-muted-foreground">请重试；如果仍未恢复，也可以直接在上方搜索商品或输入 JAN 码。</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCatalogRetry((value) => value + 1)} disabled={catalogLoading}><RotateCcw />重新加载</Button><Button variant="ghost" onClick={() => document.getElementById("product-search")?.focus()}>开始搜索</Button></div></div>}
              {catalogLoading && !catalog.length && <div className="grid gap-5 md:grid-cols-2" aria-hidden="true">{[0, 1].map((item) => <div key={item} className="overflow-hidden rounded-2xl border bg-card"><div className="aspect-[16/10] animate-pulse bg-muted" /><div className="space-y-4 p-5"><div className="h-3 w-20 animate-pulse rounded bg-muted" /><div className="h-6 w-3/4 animate-pulse rounded bg-muted" /><div className="h-16 animate-pulse rounded-xl bg-muted" /></div></div>)}</div>}
              <motion.div layout className="grid gap-5 md:grid-cols-2"><AnimatePresence mode="popLayout">{filtered.map((product, index) => <ProductCard key={product.id} product={product} featured={index === 0} selected={selected.includes(product.id)} selectionFull={selected.length >= MAX_COMPARE} onToggle={toggleProduct} reduceMotion={reduceMotion} location={location} priceLoading={priceLoading[product.id]} priceChecked={priceChecked[product.id]} priceError={priceErrors[product.id]} onLoadPrices={loadPrices} session={session} />)}</AnimatePresence></motion.div>
              {!catalogLoading && !catalogError && catalogHasMore && <div className="mt-8 flex justify-center"><Button variant="outline" size="lg" onClick={loadMoreProducts} disabled={catalogLoadingMore}>{catalogLoadingMore && <LoaderCircle className="animate-spin" />}{catalogLoadingMore ? "正在加载" : "加载更多商品"}</Button></div>}
              {!catalogLoading && !catalogError && !filtered.length && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid min-h-80 place-items-center rounded-2xl border border-dashed bg-muted/30 p-8 text-center"><div><Pill className="mx-auto size-8 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">没有符合条件的商品</h3><p className="mt-2 text-sm text-muted-foreground">{query.trim() ? <>没有找到“<span className="font-medium text-foreground">{query.trim()}</span>”，可以检查名称、品牌或 JAN 码。</> : "换品牌、分类或价格条件试试。"}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{query.trim() && <Button variant="outline" onClick={() => { setQuery(""); document.getElementById("product-search")?.focus() }}>清除搜索</Button>}<Button onClick={resetFilters}>清除全部筛选</Button></div></div></motion.div>}
            </div>
          </div>
        </section>
      </main>

      <AnimatePresence>{selectedProducts.length > 0 && <motion.div initial={reduceMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: 24 }} className="fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-xl border bg-popover p-3 shadow-lg"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">已选 {selectedProducts.length} 件</p><Button id="view-compare" onClick={() => setCompareOpen(true)}>查看清单<ChevronRight /></Button></div></motion.div>}</AnimatePresence>

      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} selectedProducts={selectedProducts} commercialOffers={commercialOffers} onCommercial={openCommercialOffer} onRemove={toggleProduct} onLoadPrices={loadComparePrices} priceLoading={priceLoading} priceChecked={priceChecked} priceErrors={priceErrors} session={session} onClear={() => setSelected([])} />
      <ScannerDialog open={scanOpen} onOpenChange={setScanOpen} onFound={handleScannedProduct} session={session} />
      <LoginDialog open={authOpen} onOpenChange={handleAuthOpenChange} onSignedIn={handleSignedIn} priceIntent={Boolean(pendingPriceId)} />
    </div>
  )
}
