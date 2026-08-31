import { motion } from "motion/react"
import { Activity, Boxes, Building2, Coins, PackageCheck, RefreshCw, Save, ShieldAlert, Tags } from "lucide-react"
import { useEffect, useState } from "react"

import AppShell, { AppLoading } from "@/components/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  adminAdjustCredits,
  adminDeletePrice,
  adminDeleteProduct,
  adminDeleteStore,
  adminFetchPriceHealth,
  adminFetchProfiles,
  adminFetchTelemetryRecent,
  adminFetchTelemetrySummary,
  adminReviewPriceSubmission,
  adminReviewProductSubmission,
  adminUpdateAppSetting,
  adminUpsertPrice,
  adminUpsertProduct,
  adminUpsertStore,
  fetchAppSettings,
  fetchCurrentProfile,
  fetchPendingPriceSubmissions,
  fetchProductSubmissions,
  fetchRecentPrices,
  friendlyApiError,
  getSession,
  searchProducts,
  searchStores,
} from "@/lib/aprice-api.mjs"
import { formatPrice } from "@/lib/products.mjs"
import { appPath } from "@/lib/paths.mjs"

const blankProduct = { id: "", barcode: "", name: "", brand: "", pack: "", category: "", tone: "sunset", description: "", image_url: "" }
const blankStore = { id: "", name: "", chain_name: "", pref: "", city: "", address: "", lat: "", lng: "", hours: "" }
const blankPrice = { id: "", product_id: "", store_id: "", price_yen: "", is_member_price: false, source: "manual", note: "" }
const settingOptions = [
  ["daily_free_searches", "每日免费商品检索"], ["daily_free_price_references", "每日免费价格查询"],
  ["search_cost_after_free", "超额检索积分"], ["price_reference_cost", "价格查询积分"],
  ["approved_contribution_reward", "贡献审核奖励"], ["consensus_required_users", "价格共识人数"],
  ["consensus_window_days", "共识有效天数"], ["task_claim_limit_per_day", "每日任务上限"],
  ["task_expiry_hours", "任务有效小时"], ["stale_price_days", "价格过期天数"], ["low_balance_threshold", "低积分提醒阈值"],
]

const dateText = (value) => {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date) : "未知"
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>{children}</label>
}

function TelemetrySummary({ data = {} }) {
  const metrics = [
    ["会话", data.sessions],
    ["搜索会话", data.search_sessions],
    ["商品查看", data.product_view_sessions],
    ["匿名预览", data.preview_sessions],
    ["完整查价", data.price_query_sessions],
    ["登录成功", data.login_completed_sessions],
    ["地图打开", data.map_open_sessions],
    ["清单分享", data.share_sessions],
    ["分享落地", data.shared_list_open_sessions],
    ["预览 → 登录意图", data.preview_to_login_intent_percent, "%"],
    ["预览 → 登录成功", data.preview_to_login_percent, "%"],
    ["查价 → 地图", data.price_to_map_percent, "%"],
  ]
  return <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([label, value, suffix = ""]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}{suffix}</p></div>)}</div>
}

function PriceHealthSummary({ data = {}, onOpenProduct }) {
  const enabled = Number.isFinite(Number(data.total_products))
  const metrics = [
    ["近期报价覆盖率", data.fresh_coverage_percent, "%"],
    ["有近期价格", data.products_with_fresh_price],
    ["无近期价格", data.products_without_fresh_price],
    ["过期门店报价", data.stale_store_price_percent, "%"],
    ["每商品有效门店", data.average_fresh_stores_per_priced_product],
  ]
  const needsPrices = Array.isArray(data.products_needing_prices) ? data.products_needing_prices : []

  return <section className="border-t pt-6 lg:col-span-2">
    <p className="text-sm text-muted-foreground">近 {data.days || 30} 天 · 普通店头价</p>
    <h2 className="mt-1 text-2xl font-semibold">价格覆盖健康度</h2>
    <p className="mt-2 text-sm text-muted-foreground">优先补齐没有有效报价的商品，并持续降低过期报价比例。</p>
    {enabled ? <>
      <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">{metrics.map(([label, value, suffix = ""]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}{suffix}</p></div>)}</div>
      <div className="mt-8"><div className="flex items-end justify-between gap-4"><div><h3 className="font-semibold">优先补价商品</h3><p className="mt-1 text-xs text-muted-foreground">按当前窗口没有任何有效门店报价</p></div><span className="font-mono text-sm text-muted-foreground">{data.products_without_fresh_price ?? 0} 件</span></div><div className="mt-3 divide-y border-y">{needsPrices.length ? needsPrices.map((item) => <button type="button" key={item.id} onClick={() => onOpenProduct(item)} className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="block truncate font-medium">{item.name || item.id}</span><span className="mt-1 block truncate text-xs text-muted-foreground">JAN {item.barcode || "未登记"}</span></span><span className="shrink-0 text-xs text-muted-foreground">查看商品</span></button>) : <p className="py-8 text-center text-sm text-muted-foreground">当前窗口内所有商品均有有效报价。</p>}</div></div>
    </> : <div className="mt-5 border-y py-8"><p className="font-medium">价格健康度尚未启用</p><p className="mt-1 text-sm text-muted-foreground">执行已准备的数据库迁移后，这里会自动显示覆盖指标。</p></div>}
  </section>
}

export default function AdminApp() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState("review")
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [prices, setPrices] = useState([])
  const [priceReviews, setPriceReviews] = useState([])
  const [productReviews, setProductReviews] = useState([])
  const [profiles, setProfiles] = useState([])
  const [settings, setSettings] = useState({})
  const [telemetry, setTelemetry] = useState({})
  const [telemetryRecent, setTelemetryRecent] = useState([])
  const [priceHealth, setPriceHealth] = useState({})
  const [productForm, setProductForm] = useState(blankProduct)
  const [storeForm, setStoreForm] = useState(blankStore)
  const [priceForm, setPriceForm] = useState(blankPrice)
  const [creditForm, setCreditForm] = useState({ user_id: "", amount: "", note: "" })
  const [settingForm, setSettingForm] = useState({ setting_key: "daily_free_price_references", setting_value: "" })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [productQuery, setProductQuery] = useState("")
  const [storeQuery, setStoreQuery] = useState("")

  const refresh = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const activeSession = await getSession()
      setSession(activeSession)
      if (!activeSession) return
      const activeProfile = await fetchCurrentProfile()
      setProfile(activeProfile)
      if (activeProfile.role !== "admin") return
      const results = await Promise.allSettled([
        searchProducts("", 500, { curated: false }), searchStores("", 500), fetchRecentPrices(100), fetchPendingPriceSubmissions(100), fetchProductSubmissions(100), adminFetchProfiles(100), fetchAppSettings(), adminFetchTelemetrySummary({ days: 7 }), adminFetchTelemetryRecent({ limit: 30 }), adminFetchPriceHealth({ days: 30, limit: 20 }),
      ])
      const value = (index, fallback) => results[index].status === "fulfilled" ? results[index].value : fallback
      setProducts(value(0, silent ? products : []))
      setStores(value(1, silent ? stores : []))
      setPrices(value(2, silent ? prices : []))
      setPriceReviews(value(3, silent ? priceReviews : []))
      setProductReviews(value(4, silent ? productReviews : []))
      setProfiles(value(5, silent ? profiles : []))
      setSettings(value(6, silent ? settings : {}))
      setTelemetry(value(7, silent ? telemetry : {}))
      setTelemetryRecent(value(8, silent ? telemetryRecent : []))
      setPriceHealth(value(9, silent ? priceHealth : {}))
      if (results.some(({ status }) => status === "rejected")) setStatus("部分后台数据加载失败，可刷新重试；已加载的功能仍可使用。")
    } catch (error) { setStatus(friendlyApiError(error)) } finally { if (!silent) setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const act = async (work, success) => {
    if (busy) return false
    setBusy(true)
    setStatus("正在处理…")
    try { await work(); setStatus(success); await refresh(true); return true } catch (error) { setStatus(friendlyApiError(error)); return false } finally { setBusy(false) }
  }

  const saveProduct = async (event) => { event.preventDefault(); if (await act(() => adminUpsertProduct(productForm), "商品已保存。")) setProductForm(blankProduct) }
  const saveStore = async (event) => {
    event.preventDefault()
    const lat = Number(storeForm.lat)
    const lng = Number(storeForm.lng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) { setStatus("请输入有效的纬度（-90～90）和经度（-180～180）。"); return }
    if (await act(() => adminUpsertStore({ ...storeForm, lat, lng }), "门店已保存。")) setStoreForm(blankStore)
  }
  const savePrice = async (event) => {
    event.preventDefault()
    const price = Number(priceForm.price_yen)
    if (!Number.isInteger(price) || price <= 0) { setStatus("请输入大于 0 的整数日元价格。"); return }
    if (await act(() => adminUpsertPrice({ ...priceForm, price_yen: price, collected_at: new Date().toISOString() }), "价格已保存。")) setPriceForm(blankPrice)
  }
  const reviewPrice = (id, action) => { if (window.confirm(`确认${action === "approve" ? "通过" : "拒绝"}这条价格提交？`)) act(() => adminReviewPriceSubmission(id, action), "价格审核已完成。") }
  const reviewProduct = (id, action) => { if (window.confirm(`确认${action === "approve" ? "通过" : "拒绝"}这条商品提交？`)) act(() => adminReviewProductSubmission(id, action), "商品审核已完成。") }
  const remove = (type, id) => {
    if (!window.confirm(`确认删除 ${id}？此操作不可撤销。`)) return
    const action = type === "product" ? adminDeleteProduct : type === "store" ? adminDeleteStore : adminDeletePrice
    act(() => action(id), "记录已删除。")
  }
  const adjustCredits = async (event) => {
    event.preventDefault()
    const amount = Number(creditForm.amount)
    if (!Number.isInteger(amount) || amount === 0 || !creditForm.note.trim()) { setStatus("积分调整必须是非零整数，并填写原因。"); return }
    if (await act(() => adminAdjustCredits({ ...creditForm, amount }), "积分已调整。")) setCreditForm({ user_id: "", amount: "", note: "" })
  }
  const saveSetting = (event) => {
    event.preventDefault()
    const numeric = Number(settingForm.setting_value)
    if (!Number.isInteger(numeric) || numeric < 0) { setStatus("业务参数必须是大于或等于 0 的整数。"); return }
    act(() => adminUpdateAppSetting({ setting_key: settingForm.setting_key, setting_value: numeric }), "业务参数已更新。")
  }
  const findProducts = async (event) => {
    event.preventDefault()
    try { setProducts(await searchProducts(productQuery, 500, { curated: false })); setStatus(productQuery ? "商品搜索已更新。" : "已显示最近商品。") } catch (error) { setStatus(friendlyApiError(error)) }
  }
  const findStores = async (event) => {
    event.preventDefault()
    try { setStores(await searchStores(storeQuery, 500)); setStatus(storeQuery ? "门店搜索已更新。" : "已显示最近门店。") } catch (error) { setStatus(friendlyApiError(error)) }
  }
  const openProduct = async (item) => {
    const query = item.barcode || item.name || item.id
    setProductQuery(query)
    setTab("products")
    try { setProducts(await searchProducts(query, 500, { curated: false })) } catch (error) { setStatus(friendlyApiError(error)) }
  }

  if (loading) return <AppShell title="管理后台"><AppLoading label="正在核验管理员权限" /></AppShell>
  if (!session) return <AppShell eyebrow="管理后台" title="需要登录" description="请使用管理员账号继续。"><div className="mx-auto max-w-[1440px] px-4 pb-24"><Button asChild><a href={appPath(`/login/?redirect=${encodeURIComponent(appPath("/admin/"))}`)}>登录</a></Button></div></AppShell>
  if (profile?.role !== "admin") return <AppShell eyebrow="管理后台" title="没有管理员权限" description="当前账号只能使用个人功能。" session={session} profile={profile}><div className="mx-auto max-w-[1440px] px-4 pb-24"><Button asChild><a href={appPath("/me/")}>返回个人中心</a></Button></div></AppShell>

  const tabs = [["review", "审核", PackageCheck], ["products", "商品", Boxes], ["stores", "门店", Building2], ["prices", "价格", Tags], ["business", "业务", Activity]]
  const staleDays = Math.max(1, Number(settings.stale_price_days) || 30)
  const staleBefore = Date.now() - staleDays * 86400000
  const operations = [
    ["待审核", priceReviews.length + productReviews.length, "review"],
    ["商品资料缺项", products.filter((item) => !item.brand || !item.pack || !item.image_url).length, "products"],
    ["门店资料缺项", stores.filter((item) => !item.address || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng))).length, "stores"],
    [`近期过期报价（${staleDays} 天）`, prices.filter((item) => { const time = new Date(item.collected_at).getTime(); return !Number.isFinite(time) || time < staleBefore }).length, "prices"],
  ]
  return (
    <AppShell title="管理工作台" description="审核提交并维护业务数据。" session={session} profile={profile} actions={<Button variant="outline" onClick={() => act(() => Promise.resolve(), "数据已刷新。")} disabled={busy}><RefreshCw className={busy ? "animate-spin" : ""} /> 刷新</Button>}>
      <section className={`mx-auto max-w-[1320px] px-4 pb-24 transition-opacity sm:px-6 lg:px-8 ${busy ? "pointer-events-none opacity-70" : ""}`} aria-busy={busy}>
        <nav className="flex snap-x gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5 shadow-sm" role="tablist" aria-label="管理功能">{tabs.map(([value, label, Icon]) => <Button key={value} id={`admin-tab-${value}`} role="tab" className="shrink-0 snap-start rounded-xl" variant={tab === value ? "default" : "ghost"} onClick={() => setTab(value)} aria-selected={tab === value} aria-controls={`admin-panel-${value}`}><Icon /> {label}</Button>)}</nav>
        {status && <div className="mt-6 rounded-xl border bg-card px-4 py-3 text-sm" role="status">{status}</div>}
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-b pb-8 lg:grid-cols-4" aria-label="运营待办概览">{operations.map(([label, value, target]) => <button type="button" key={label} onClick={() => setTab(target)} className="min-h-16 border-t pt-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block text-xs text-muted-foreground">{label}</span><span className="mt-1 block font-mono text-2xl font-semibold">{value}</span></button>)}</div>

        {tab === "review" && <motion.div id="admin-panel-review" role="tabpanel" aria-labelledby="admin-tab-review" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-10 grid gap-12 lg:grid-cols-2">
          <section><div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">社区价格</p><h2 className="mt-1 text-2xl font-semibold">待审核价格</h2></div><Badge>{priceReviews.length}</Badge></div><div className="mt-5 divide-y border-y">{priceReviews.length ? priceReviews.map((item) => <div key={item.id} className="py-5"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{item.products?.name || item.product_id}</p><p className="mt-1 text-xs text-muted-foreground">{item.stores?.name || item.store_id} · {dateText(item.created_at)} · {item.note || "无备注"}</p></div><span className="font-mono font-semibold">{formatPrice(item.price_yen)}</span></div><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => reviewPrice(item.id, "approve")}>通过</Button><Button size="sm" variant="outline" onClick={() => reviewPrice(item.id, "reject")}>拒绝</Button></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">没有待审核价格。</p>}</div></section>
          <section><div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">扫码补录</p><h2 className="mt-1 text-2xl font-semibold">待审核商品</h2></div><Badge>{productReviews.length}</Badge></div><div className="mt-5 divide-y border-y">{productReviews.length ? productReviews.map((item) => <div key={item.id} className="py-5"><div><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.brand || "品牌未登记"} · JAN {item.barcode} · {item.pack || "规格未登记"}</p></div><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => reviewProduct(item.id, "approve")}>通过</Button><Button size="sm" variant="outline" onClick={() => reviewProduct(item.id, "reject")}>拒绝</Button></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">没有待审核商品。</p>}</div></section>
        </motion.div>}

        {tab === "products" && <div id="admin-panel-products" role="tabpanel" aria-labelledby="admin-tab-products" className="mt-10 grid gap-10 lg:grid-cols-[0.75fr_1.25fr]"><form onSubmit={saveProduct} className="rounded-2xl border bg-card p-5 sm:p-6 lg:sticky lg:top-24 lg:self-start"><h2 className="text-xl font-semibold">{productForm.id ? "编辑商品" : "新增商品"}</h2><div className="mt-6 space-y-4"><Field label="商品 ID"><Input value={productForm.id} onChange={(e) => setProductForm({ ...productForm, id: e.target.value })} placeholder="可与 JAN 相同" /></Field><Field label="JAN 码"><Input value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} inputMode="numeric" required /></Field><Field label="商品名称"><Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required /></Field><Field label="品牌"><Input value={productForm.brand} onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="规格"><Input value={productForm.pack} onChange={(e) => setProductForm({ ...productForm, pack: e.target.value })} /></Field><Field label="分类"><Input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} /></Field></div><Field label="图片 URL"><Input type="url" value={productForm.image_url} onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })} /></Field><Field label="商品说明"><textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} className="min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /></Field><div className="flex gap-2"><Button type="submit"><Save /> 保存</Button><Button type="button" variant="outline" onClick={() => setProductForm(blankProduct)}>清空</Button></div></div></form><section><h2 className="text-2xl font-semibold">商品库</h2><form onSubmit={findProducts} className="mt-4 flex gap-2"><Input type="search" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="商品名、品牌、分类或 JAN 码" aria-label="搜索后台商品" /><Button type="submit" variant="outline">搜索</Button></form><div className="mt-5 divide-y border-y">{products.map((item) => <div key={item.id} className="flex items-center gap-2 py-4 sm:gap-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.brand || "品牌未登记"} · {item.pack || "规格未登记"} · JAN {item.barcode}</p></div><Button size="sm" variant="ghost" onClick={() => setProductForm({ ...blankProduct, ...item })} aria-label={`编辑 ${item.name}`}>编辑</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove("product", item.id)} aria-label={`删除 ${item.name}`}>删除</Button></div>)}</div></section></div>}

        {tab === "stores" && <div id="admin-panel-stores" role="tabpanel" aria-labelledby="admin-tab-stores" className="mt-10 grid gap-10 lg:grid-cols-[0.75fr_1.25fr]"><form onSubmit={saveStore} className="rounded-2xl border bg-card p-5 sm:p-6 lg:sticky lg:top-24 lg:self-start"><h2 className="text-xl font-semibold">{storeForm.id ? "编辑门店" : "新增门店"}</h2><div className="mt-6 space-y-4"><Field label="门店 ID"><Input value={storeForm.id} onChange={(e) => setStoreForm({ ...storeForm, id: e.target.value })} /></Field><Field label="门店名称"><Input value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} required /></Field><Field label="连锁名"><Input value={storeForm.chain_name} onChange={(e) => setStoreForm({ ...storeForm, chain_name: e.target.value })} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="都道府县"><Input value={storeForm.pref} onChange={(e) => setStoreForm({ ...storeForm, pref: e.target.value })} /></Field><Field label="城市"><Input value={storeForm.city} onChange={(e) => setStoreForm({ ...storeForm, city: e.target.value })} /></Field></div><Field label="地址"><Input value={storeForm.address} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="纬度"><Input type="number" step="any" value={storeForm.lat} onChange={(e) => setStoreForm({ ...storeForm, lat: e.target.value })} required /></Field><Field label="经度"><Input type="number" step="any" value={storeForm.lng} onChange={(e) => setStoreForm({ ...storeForm, lng: e.target.value })} required /></Field></div><Field label="营业时间"><Input value={storeForm.hours} onChange={(e) => setStoreForm({ ...storeForm, hours: e.target.value })} /></Field><div className="flex gap-2"><Button type="submit"><Save /> 保存</Button><Button type="button" variant="outline" onClick={() => setStoreForm(blankStore)}>清空</Button></div></div></form><section><h2 className="text-2xl font-semibold">门店库</h2><form onSubmit={findStores} className="mt-4 flex gap-2"><Input type="search" value={storeQuery} onChange={(event) => setStoreQuery(event.target.value)} placeholder="店名、连锁、城市或地址" aria-label="搜索后台门店" /><Button type="submit" variant="outline">搜索</Button></form><div className="mt-5 divide-y border-y">{stores.map((item) => <div key={item.id} className="flex items-center gap-2 py-4 sm:gap-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.chain_name || "独立门店"} · {[item.pref, item.city, item.address].filter(Boolean).join(" ")}</p></div><Button size="sm" variant="ghost" onClick={() => setStoreForm({ ...blankStore, ...item, lat: String(item.lat ?? ""), lng: String(item.lng ?? "") })} aria-label={`编辑 ${item.name}`}>编辑</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove("store", item.id)} aria-label={`删除 ${item.name}`}>删除</Button></div>)}</div></section></div>}

        {tab === "prices" && <div id="admin-panel-prices" role="tabpanel" aria-labelledby="admin-tab-prices" className="mt-10 grid gap-10 lg:grid-cols-[0.75fr_1.25fr]"><form onSubmit={savePrice} className="rounded-2xl border bg-card p-5 sm:p-6 lg:sticky lg:top-24 lg:self-start"><h2 className="text-xl font-semibold">录入门店价格</h2><div className="mt-6 space-y-4"><Field label="商品"><select value={priceForm.product_id} onChange={(e) => setPriceForm({ ...priceForm, product_id: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" required><option value="">选择商品</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="门店"><select value={priceForm.store_id} onChange={(e) => setPriceForm({ ...priceForm, store_id: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" required><option value="">选择门店</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="价格（日元）"><Input type="number" min="1" step="1" value={priceForm.price_yen} onChange={(e) => setPriceForm({ ...priceForm, price_yen: e.target.value })} required /></Field><Field label="备注"><Input value={priceForm.note} onChange={(e) => setPriceForm({ ...priceForm, note: e.target.value })} /></Field><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={priceForm.is_member_price} onChange={(e) => setPriceForm({ ...priceForm, is_member_price: e.target.checked })} /> 会员价</label><Button type="submit"><Save /> 保存价格</Button></div></form><section><h2 className="text-2xl font-semibold">最近价格</h2><div className="mt-5 divide-y border-y">{prices.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 py-4 sm:gap-4"><div className="min-w-48 flex-1"><p className="truncate font-medium">{item.products?.name || item.product_id}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.stores?.name || item.store_id} · {dateText(item.collected_at)}</p></div><span className="font-mono font-semibold">{formatPrice(item.price_yen)}</span><Button size="sm" variant="ghost" onClick={() => setPriceForm({ ...blankPrice, ...item, price_yen: String(item.price_yen) })} aria-label="编辑价格">编辑</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove("price", item.id)} aria-label="删除价格">删除</Button></div>)}</div></section></div>}

        {tab === "business" && <div id="admin-panel-business" role="tabpanel" aria-labelledby="admin-tab-business" className="mt-10 grid gap-12 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">调整用户积分</h2><p className="mt-2 text-sm text-muted-foreground">写入积分流水并即时更新余额。</p></div><Coins className="size-5 text-primary" /></div><form onSubmit={adjustCredits} className="mt-6 space-y-4"><Field label="用户"><select value={creditForm.user_id} onChange={(e) => setCreditForm({ ...creditForm, user_id: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" required><option value="">选择用户</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.email || item.id}</option>)}</select></Field><Field label="增减积分"><Input type="number" step="1" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} placeholder="例如 10 或 -10" required /></Field><Field label="调整原因"><Input value={creditForm.note} onChange={(e) => setCreditForm({ ...creditForm, note: e.target.value })} placeholder="必填，写入积分流水" required /></Field><Button type="submit">调整积分</Button></form></section>
          <section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">业务参数</h2><p className="mt-2 text-sm text-muted-foreground">仅可更新数据库允许的白名单键。</p></div><ShieldAlert className="size-5 text-primary" /></div><form onSubmit={saveSetting} className="mt-6 space-y-4"><Field label="参数"><select value={settingForm.setting_key} onChange={(e) => setSettingForm({ ...settingForm, setting_key: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm">{settingOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="新值"><Input type="number" min="0" step="1" value={settingForm.setting_value} onChange={(e) => setSettingForm({ ...settingForm, setting_value: e.target.value })} required /></Field><Button type="submit">更新参数</Button></form><pre className="mt-6 max-h-56 overflow-auto rounded-xl bg-muted p-4 text-xs">{JSON.stringify(settings, null, 2)}</pre></section>
          <PriceHealthSummary data={priceHealth} onOpenProduct={openProduct} />
          <section className="border-t pt-6 lg:col-span-2"><p className="text-sm text-muted-foreground">近 {telemetry.days || 7} 天</p><h2 className="mt-1 text-2xl font-semibold">商业漏斗</h2><p className="mt-2 text-sm text-muted-foreground">按匿名会话聚合，转化率不使用事件次数重复计数。</p><TelemetrySummary data={telemetry} /><div className="mt-8"><h3 className="font-semibold">最近事件</h3><div className="mt-3 divide-y border-y">{telemetryRecent.length ? telemetryRecent.slice(0, 12).map((item, index) => <div key={item.id || `${item.event_name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="font-medium">{item.event_name || "unknown"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.email || item.user_id || "anonymous"} · {dateText(item.occurred_at)}</p></div><code className="max-w-full truncate text-xs text-muted-foreground">{JSON.stringify(item.payload || {})}</code></div>) : <p className="py-8 text-center text-sm text-muted-foreground">暂无最近事件。</p>}</div></div></section>
        </div>}
      </section>
    </AppShell>
  )
}
