import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  BadgeJapaneseYen,
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
  Scale,
  ScanLine,
  Search,
  Share2,
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
  fetchCommercialOffers,
  fetchJancodeProductDraft,
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
  getMapUrl,
  getPriceStats,
  isOnlineStore,
  MAX_COMPARE,
  MAX_PRICE,
  MIN_PRICE,
  products as demoProducts,
  sanitizeCompareSelection,
  sanitizePriceSnapshots,
} from "@/lib/products.mjs"
import { appPath } from "@/lib/paths.mjs"

const formatDate = (value) => {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date) : "日期未知"
}

const comparisonRows = [
  ["最低价", (product) => formatPrice(getPriceStats(product).min)],
  ["单位价格", formatUnitPrice],
  ["最低价来源", (product) => getPriceStats(product).bestOffer?.name || "待查询"],
  ["规格", (product) => product.pack],
  ["分类", (product) => product.category],
  ["商品说明", (product) => product.active],
  ["报价来源", (product) => `${product.offers.length} 个`],
  ["报价更新", (product) => formatDate(Math.max(0, ...product.offers.map(({ sampledAt }) => Date.parse(sampledAt) || 0)))],
  ["JAN 码", (product) => product.barcode || "未登记"],
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
  const [status, setStatus] = useState("可启动后置相机，或手动输入 JAN 码。")
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
        setDraft(external || { id: barcode, barcode, name: "", brand: "", pack: "", category: "", tone: "sunset", description: "", image_url: "" })
        setStatus(external ? "已从 JANCODE 预填，请确认后提交审核。" : "JANCODE 也没有记录，请手动填写后提交审核。")
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
      <DialogContent className="max-h-[90dvh] max-w-[min(560px,calc(100vw-2rem))] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="size-5 text-primary" /> 扫码检索</DialogTitle>
          <DialogDescription>将商品条码放入取景框，首次使用请允许浏览器访问相机。</DialogDescription>
        </DialogHeader>
        <div className="relative mt-2 aspect-[16/10] overflow-hidden rounded-2xl border bg-slate-950 sm:aspect-[4/3]">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="条码扫描相机预览" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 bg-primary" />
          {!scanning && <div className="absolute inset-0 grid place-items-center text-center text-sm text-white/65"><Camera className="mx-auto mb-3 size-8" />相机尚未启动</div>}
        </div>
        {scanning ? <Button variant="outline" onClick={stopCamera}><Camera /> 停止相机</Button> : <Button onClick={startCamera}><Camera /> 启动相机</Button>}
        <form onSubmit={(event) => { event.preventDefault(); lookup(manualCode) }}>
          <label htmlFor="manual-jan" className="mb-2 block text-sm font-medium">手动输入 JAN 码</label>
          <div className="flex gap-2"><Input id="manual-jan" value={manualCode} onChange={(event) => setManualCode(event.target.value)} inputMode="numeric" placeholder="例如 4901234567894" disabled={lookingUp} /><Button type="submit" variant="secondary" disabled={lookingUp}>{lookingUp && <LoaderCircle className="animate-spin" />}{lookingUp ? "查询中" : "查询"}</Button></div>
        </form>
        <p className="min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>
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
          <DialogTitle>{priceIntent ? "登录后继续查价" : "登录 AAPRICE"}</DialogTitle>
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
        <a href={appPath(`/product/?id=${encodeURIComponent(product.id)}`)} aria-label={`查看 ${product.name} 详情`} className={`relative block overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring ${featured ? "aspect-[16/10] md:aspect-auto md:min-h-[31rem]" : "aspect-[16/10] md:aspect-[4/3]"}`}>
          <motion.img layoutId={`image-${product.id}`} src={product.image} alt={`${product.name} 药妆商品示意图`} loading={featured ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.035]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
          {featured && <div className="absolute bottom-5 left-5 hidden text-white md:block"><p className="text-xs font-medium uppercase tracking-[0.18em] text-white/75">实时目录</p><p className="mt-1 text-lg font-semibold">扫码、搜索、按需查询价格</p></div>}
        </a>

        <div className={`flex flex-col p-4 md:p-5 ${featured ? "justify-between md:p-8" : "gap-4 md:gap-5"}`}>
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{product.maker}</p>
                <h3 className={`mt-1 font-semibold tracking-tight ${featured ? "text-xl md:text-3xl" : "text-xl"}`}><a href={appPath(`/product/?id=${encodeURIComponent(product.id)}`)} className="inline-flex min-h-11 items-center outline-none transition hover:text-primary focus-visible:ring-2">{product.name}</a></h3>
              </div>
              <Badge className="shrink-0 gap-1 bg-primary/10 text-primary hover:bg-primary/10"><Store className="size-3" /> {hasPrices ? `${stats.storeCount} 源` : "待查价"}</Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 md:mt-5">
              <Badge variant="secondary">{product.category}</Badge>
              {product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
            </div>

            <div className="mt-6 hidden grid-cols-2 gap-4 text-sm md:grid">
              <div><p className="text-muted-foreground">规格 / 单位价</p><p className="mt-1 font-medium">{product.pack} · {formatUnitPrice(product)}</p></div>
              <div><p className="text-muted-foreground">JAN 码</p><p className="mt-1 break-all font-mono font-medium">{product.barcode || "未登记"}</p></div>
              {featured && <div className="col-span-2"><p className="text-muted-foreground">商品说明</p><p className="mt-1 line-clamp-3 font-medium">{product.active}</p></div>}
            </div>

            {featured && hasPrices && (
              <div className="mt-7 hidden overflow-hidden rounded-xl border bg-muted/35 md:block">
                {offers.slice(0, 3).map((item, index) => {
                  const nearby = getClosestOffer({ offers: [item] }, location)
                  return <div key={item.id || item.name} className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${index ? "border-t" : ""}`}>
                    <div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.member ? "会员价" : isOnlineStore(item) ? "在线价" : "店头价"} · {formatDate(item.sampledAt)}{nearby && ` · ${formatDistance(nearby.distance)}`}</p></div>
                    <span className="shrink-0 font-mono font-semibold">{formatPrice(item.price)}</span>
                  </div>
                })}
              </div>
            )}

            {!featured && hasPrices && <p className="mt-3 truncate text-xs text-muted-foreground md:mt-5">最低 {stats.bestOffer.name} · {formatDate(stats.bestOffer.sampledAt)}{closest && ` · 最近 ${closest.name} ${formatDistance(closest.distance)}`}</p>}
            {!hasPrices && <p className="mt-3 text-xs text-muted-foreground md:mt-5">{priceError || (priceChecked ? "该商品暂无近期报价。" : "登录后按需查询，不会在浏览目录时消耗额度。")}</p>}
          </div>

          <div className={`flex items-end justify-between gap-4 ${featured ? "mt-5 md:mt-8" : "mt-auto"}`}>
            <div>
              <p className="text-xs text-muted-foreground">{hasPrices ? `报价最高 ${formatPrice(stats.max)} · 可省 ${formatPrice(stats.saving)}` : "同一后台实时返回"}</p>
              <p className="font-mono text-2xl font-semibold tracking-tight">{formatPrice(stats.min)}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button asChild variant="ghost" className="px-2.5"><a href={appPath(`/product/?id=${encodeURIComponent(product.id)}`)}>详情<ChevronRight /></a></Button>
              {hasPrices ? (
                <Button variant={selected ? "default" : "outline"} onClick={() => onToggle(product.id)} disabled={!selected && selectionFull} aria-pressed={selected}>
                  {selected ? <Check /> : <Plus />}{selected ? "已加入" : "加入清单"}
                </Button>
              ) : (
                <Button onClick={() => onLoadPrices(product.id)} disabled={priceLoading}>
                  {priceLoading ? <LoaderCircle className="animate-spin" /> : <BadgeJapaneseYen />}{priceLoading ? "查询中" : priceChecked ? "重新查询" : "查询报价"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  )
}

function CompareDialog({ open, onOpenChange, selectedProducts, commercialOffers, onCommercial, onRemove, onLoadPrices, priceLoading, priceChecked, priceErrors }) {
  const [shareStatus, setShareStatus] = useState("")
  const [commercialStatus, setCommercialStatus] = useState("")
  const summary = getBasketSummary(selectedProducts)
  const singleStore = getBestSingleStoreBasket(selectedProducts)

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[min(1100px,calc(100vw-2rem))] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-5 text-left"><div className="flex items-start justify-between gap-4 pr-8"><div><DialogTitle className="text-xl">比价清单</DialogTitle><DialogDescription className="mt-1">报价来自近期价格库，合计仅统计已查价商品。</DialogDescription>{(shareStatus || commercialStatus) && <p className="mt-2 text-xs text-muted-foreground" role="status">{commercialStatus || shareStatus}</p>}</div><Button className="shrink-0" variant="outline" size="sm" onClick={shareList}><Share2 />分享</Button></div>{summary.pricedCount > 0 && <div className="flex flex-wrap gap-x-8 gap-y-3 pt-3"><div><p className="text-xs text-muted-foreground">逐件最低合计</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{formatPrice(summary.minimumTotal)}</p></div><div><p className="text-xs text-muted-foreground">可见差价合计</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{formatPrice(summary.visibleSaving)}</p></div>{selectedProducts.length > 1 && singleStore && <div><p className="text-xs text-muted-foreground">一店购最低</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{formatPrice(singleStore.total)}</p><p className="mt-1 max-w-48 truncate text-xs text-muted-foreground">{singleStore.name} · 多 {formatPrice(singleStore.premium)}{singleStore.includesMemberPrice && " · 含会员价"}</p><Button asChild variant="link" size="sm" className="-ml-3 mt-1"><a href={getMapUrl(singleStore)} target="_blank" rel="noreferrer" onClick={() => void recordTelemetryEvent("map_opened", { source: "compare_list", store_id: singleStore.id, item_count: selectedProducts.length }).catch(() => {})}><MapPin />地图查看</a></Button></div>}<p className="self-end text-xs text-muted-foreground">已查价 {summary.pricedCount}/{summary.totalCount} 件{selectedProducts.length > 1 && !singleStore && (summary.pricedCount < summary.totalCount ? " · 全部查价后计算一店购" : " · 暂无共同实体店")}</p></div>}</DialogHeader>
        <div className="overflow-auto px-4 pb-6 sm:px-6">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `150px repeat(${selectedProducts.length}, minmax(190px, 1fr))` }}>
            <div className="sticky left-0 z-10 bg-popover py-5" />
            {selectedProducts.map((product) => {
              const needsPrice = !product.offers.length
              const commercialOffer = commercialOffers.find((offer) => String(offer.product_id) === String(product.id))
              return <div key={product.id} className="border-b px-4 py-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{product.maker}</p><p className="mt-1 font-semibold">{product.name}</p></div><Button variant="ghost" size="icon-sm" onClick={() => onRemove(product.id)} aria-label={`移除 ${product.name}`}><X /></Button></div><div className="mt-3 flex flex-wrap gap-2">{needsPrice && supabaseConfigured && <Button variant="outline" size="sm" onClick={() => onLoadPrices(product.id)} disabled={priceLoading[product.id]}>{priceLoading[product.id] && <LoaderCircle className="animate-spin" />}{priceLoading[product.id] ? "查询中" : priceChecked[product.id] ? "重新查询" : "查询报价"}</Button>}{commercialOffer && <Button variant="ghost" size="sm" onClick={() => openCommercial(commercialOffer)}>合作购买</Button>}</div>{priceErrors[product.id] && <p className="mt-2 text-xs text-destructive" role="alert">{priceErrors[product.id]}</p>}</div>
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
  const [location, setLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState("idle")

  useEffect(() => { if (initialScan) setScanOpen(true) }, [initialScan])

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
    if (!supabaseConfigured) return undefined
    let active = true
    const timer = setTimeout(async () => {
      setCatalogLoading(true)
      setCatalogError("")
      try {
        const rows = await searchProducts(query)
        void recordTelemetryEvent("search_completed", { query_present: Boolean(query.trim()), result_count: rows.length }).catch(() => {})
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
  const hasCatalogPrices = catalog.some((product) => product.offers.length > 0)
  useEffect(() => {
    if (!hasCatalogPrices) {
      setBudget([MAX_PRICE])
      setSort("score")
    }
  }, [hasCatalogPrices])

  const filtered = useMemo(() => filterProducts(catalog, { query: supabaseConfigured ? "" : query, segment, maxPrice: budget[0], sort, location }), [catalog, query, segment, budget, sort, location])
  const selectedProducts = selected.map((id) => {
    const current = catalog.find((product) => product.id === id)
    const saved = savedProducts.find((product) => product.id === id)
    return saved?.offers.length ? saved : current || saved
  }).filter(Boolean)
  const basketSummary = getBasketSummary(selectedProducts)
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
      setReopenCompareAfterAuth(false)
    }
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
          <a href={appPath("/")} className="flex min-h-11 items-center gap-3" aria-label="AAPRICE 首页"><span className="grid size-9 place-items-center rounded-xl bg-primary font-mono text-sm font-bold text-primary-foreground">AA</span><span><span className="block font-semibold leading-none tracking-[-0.04em]">AAPRICE</span><span className="mt-1 block text-[10px] leading-none text-muted-foreground">日本药妆比价</span></span></a>
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
        <section className="mx-auto max-w-5xl px-4 pb-8 pt-10 sm:px-6 md:pb-12 md:pt-16 lg:px-8">
          <motion.div initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-5xl">搜商品，直接比价。</h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">输入商品名、品牌或 JAN 码。</p>
            <div className="mt-6 flex gap-2 rounded-2xl border bg-card p-2 shadow-[0_20px_60px_oklch(0.2_0.03_240_/_0.07)]">
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名、品牌或 JAN 码" aria-label="搜索商品" className="h-14 border-0 bg-transparent px-12 text-base shadow-none focus-visible:ring-0" />{query && <Button variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2" aria-label="清除搜索"><X /></Button>}</div>
              <Button size="lg" onClick={() => setScanOpen(true)} aria-label="扫码检索" className="h-14 shrink-0 px-4 sm:px-6"><ScanLine /><span className="hidden sm:inline">扫码</span></Button>
            </div>
          </motion.div>
        </section>

        <section id="catalog" className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 lg:px-8">
          <div>
            <div className="mb-6 rounded-2xl border bg-card p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setFiltersOpen((value) => !value)} className="flex min-h-11 flex-1 items-center gap-2 text-left font-semibold" aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal className="size-4" /> 筛选与排序 <ChevronDown className={`ml-auto size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} /></button>
                {hasFilters && <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw /> 重置</Button>}
              </div>
              <div id="catalog-filters" className={filtersOpen ? "block" : "hidden"}>
                <motion.div key={filtersOpen ? "filters-open" : "filters-closed"} initial={reduceMotion ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                <div className={`mt-4 grid gap-5 border-t pt-5 ${hasCatalogPrices ? "md:grid-cols-[1.3fr_1fr_0.9fr]" : "md:grid-cols-[1.3fr_1fr]"}`}>
                  <div><p className="text-sm font-medium">商品分类</p><div className="mt-3 flex flex-wrap gap-2">{segments.map((item) => <Button key={item} variant={segment === item ? "default" : "outline"} size="sm" onClick={() => setSegment(item)} aria-pressed={segment === item} className="max-w-full truncate">{item}</Button>)}</div></div>
                  {hasCatalogPrices ? <><div><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">最高预算</span><span className="font-mono text-sm">{formatPrice(budget[0])}</span></div><Slider aria-label="最高预算" value={budget} onValueChange={setBudget} min={MIN_PRICE} max={MAX_PRICE} step={100} className="mt-5" /></div>
                  <div><label htmlFor="sort" className="mb-2 block text-sm font-medium">结果排序</label><Select value={sort} onValueChange={setSort}><SelectTrigger id="sort" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="score">默认顺序</SelectItem><SelectItem value="price">最低价优先</SelectItem><SelectItem value="unit">单位价优先</SelectItem><SelectItem value="saving">差价最大</SelectItem><SelectItem value="distance">离我最近</SelectItem></SelectContent></Select><Button variant={locationStatus === "ready" ? "secondary" : "outline"} className="mt-3 w-full justify-start" onClick={locate} disabled={locationStatus === "loading" || locationStatus === "unsupported"}><MapPin /> {locationCopy}</Button></div></> : <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground"><p className="font-medium text-foreground">价格筛选将在查价后启用</p><p className="mt-1">先在商品卡片查询报价，即可按预算、价格或门店距离排序。</p></div>}
                </div>
                </motion.div>
              </div>
            </div>

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
      </main>

      <AnimatePresence>{selectedProducts.length > 0 && <motion.div initial={reduceMotion ? false : { opacity: 0, y: 80, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 60, scale: 0.97 }} transition={{ type: "spring", stiffness: 220, damping: 24 }} className="fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-3xl rounded-2xl border bg-popover/92 p-3 shadow-[0_28px_90px_oklch(0.15_0.04_240_/_0.25)] backdrop-blur-xl sm:bottom-5"><div className="flex items-center gap-3"><div className="hidden size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:grid"><Scale className="size-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">比价清单 {selectedProducts.length}/{MAX_COMPARE}</p><p className="truncate text-xs text-muted-foreground">{basketSummary.pricedCount ? `已查价 ${basketSummary.pricedCount}/${basketSummary.totalCount} 件 · 最低合计 ${formatPrice(basketSummary.minimumTotal)}` : selectedProducts.map(({ name }) => name).join(" / ")}</p></div><Button variant="ghost" size="sm" onClick={() => setSelected([])} className="hidden sm:inline-flex">清空</Button><Button onClick={() => setCompareOpen(true)}>查看清单<ChevronRight /></Button></div></motion.div>}</AnimatePresence>

      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} selectedProducts={selectedProducts} commercialOffers={commercialOffers} onCommercial={openCommercialOffer} onRemove={toggleProduct} onLoadPrices={loadComparePrices} priceLoading={priceLoading} priceChecked={priceChecked} priceErrors={priceErrors} />
      <ScannerDialog open={scanOpen} onOpenChange={setScanOpen} onFound={handleScannedProduct} session={session} />
      <LoginDialog open={authOpen} onOpenChange={handleAuthOpenChange} onSignedIn={handleSignedIn} priceIntent={Boolean(pendingPriceId)} />
    </div>
  )
}
