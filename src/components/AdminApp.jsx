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
  adminFetchProfiles,
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

const blankProduct = { id: "", barcode: "", name: "", brand: "", pack: "", category: "", tone: "sunset", description: "", image_url: "" }
const blankStore = { id: "", name: "", chain_name: "", pref: "", city: "", address: "", lat: "", lng: "", hours: "" }
const blankPrice = { id: "", product_id: "", store_id: "", price_yen: "", is_member_price: false, source: "manual", note: "" }

const dateText = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未知"

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
  const [productForm, setProductForm] = useState(blankProduct)
  const [storeForm, setStoreForm] = useState(blankStore)
  const [priceForm, setPriceForm] = useState(blankPrice)
  const [creditForm, setCreditForm] = useState({ user_id: "", amount: "", note: "" })
  const [settingForm, setSettingForm] = useState({ setting_key: "daily_free_price_references", setting_value: "" })
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("")

  const refresh = async () => {
    setLoading(true)
    try {
      const activeSession = await getSession()
      setSession(activeSession)
      if (!activeSession) return
      const activeProfile = await fetchCurrentProfile()
      setProfile(activeProfile)
      if (activeProfile.role !== "admin") return
      const [productRows, storeRows, priceRows, pendingPrices, pendingProducts, profileRows, appSettings, telemetrySummary] = await Promise.all([
        searchProducts("", 100), searchStores("", 500), fetchRecentPrices(100), fetchPendingPriceSubmissions(100), fetchProductSubmissions(100), adminFetchProfiles(100), fetchAppSettings(), adminFetchTelemetrySummary({ days: 7 }),
      ])
      setProducts(productRows)
      setStores(storeRows)
      setPrices(priceRows)
      setPriceReviews(pendingPrices)
      setProductReviews(pendingProducts)
      setProfiles(profileRows)
      setSettings(appSettings)
      setTelemetry(telemetrySummary)
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const act = async (work, success) => {
    setStatus("正在处理…")
    try { await work(); setStatus(success); await refresh() } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const saveProduct = (event) => { event.preventDefault(); act(() => adminUpsertProduct(productForm), "商品已保存。").then(() => setProductForm(blankProduct)) }
  const saveStore = (event) => { event.preventDefault(); act(() => adminUpsertStore({ ...storeForm, lat: Number(storeForm.lat), lng: Number(storeForm.lng) }), "门店已保存。").then(() => setStoreForm(blankStore)) }
  const savePrice = (event) => { event.preventDefault(); act(() => adminUpsertPrice({ ...priceForm, price_yen: Number(priceForm.price_yen), collected_at: new Date().toISOString() }), "价格已保存。").then(() => setPriceForm(blankPrice)) }
  const reviewPrice = (id, action) => { if (window.confirm(`确认${action === "approve" ? "通过" : "拒绝"}这条价格提交？`)) act(() => adminReviewPriceSubmission(id, action), "价格审核已完成。") }
  const reviewProduct = (id, action) => { if (window.confirm(`确认${action === "approve" ? "通过" : "拒绝"}这条商品提交？`)) act(() => adminReviewProductSubmission(id, action), "商品审核已完成。") }
  const remove = (type, id) => {
    if (!window.confirm(`确认删除 ${id}？此操作不可撤销。`)) return
    const action = type === "product" ? adminDeleteProduct : type === "store" ? adminDeleteStore : adminDeletePrice
    act(() => action(id), "记录已删除。")
  }
  const adjustCredits = (event) => { event.preventDefault(); act(() => adminAdjustCredits({ ...creditForm, amount: Number(creditForm.amount) }), "积分已调整。").then(() => setCreditForm({ user_id: "", amount: "", note: "" })) }
  const saveSetting = (event) => { event.preventDefault(); const numeric = Number(settingForm.setting_value); act(() => adminUpdateAppSetting({ setting_key: settingForm.setting_key, setting_value: Number.isFinite(numeric) ? numeric : settingForm.setting_value }), "业务参数已更新。") }

  if (loading) return <AppShell title="管理后台"><AppLoading label="正在核验管理员权限" /></AppShell>
  if (!session) return <AppShell eyebrow="管理后台" title="需要登录" description="请使用管理员账号继续。"><div className="mx-auto max-w-[1440px] px-4 pb-24"><Button asChild><a href="/login/?redirect=/admin/">登录</a></Button></div></AppShell>
  if (profile?.role !== "admin") return <AppShell eyebrow="管理后台" title="没有管理员权限" description="当前账号只能使用个人功能。" session={session} profile={profile}><div className="mx-auto max-w-[1440px] px-4 pb-24"><Button asChild><a href="/me/">返回个人中心</a></Button></div></AppShell>

  const tabs = [["review", "审核", PackageCheck], ["products", "商品", Boxes], ["stores", "门店", Building2], ["prices", "价格", Tags], ["business", "业务", Activity]]
  return (
    <AppShell eyebrow="管理后台" title="管理工作台" description="审核社区提交，维护商品、门店、价格与业务参数。" session={session} profile={profile} actions={<Button variant="outline" onClick={refresh}><RefreshCw /> 刷新</Button>}>
      <section className="mx-auto max-w-[1320px] px-4 pb-24 sm:px-6 lg:px-8">
        <div className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5 shadow-sm">{tabs.map(([value, label, Icon]) => <Button key={value} className="shrink-0 rounded-xl" variant={tab === value ? "default" : "ghost"} onClick={() => setTab(value)}><Icon /> {label}</Button>)}</div>
        {status && <div className="mt-6 rounded-xl border bg-card px-4 py-3 text-sm" role="status">{status}</div>}

        {tab === "review" && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-10 grid gap-12 lg:grid-cols-2">
          <section><div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">社区价格</p><h2 className="mt-1 text-2xl font-semibold">待审核价格</h2></div><Badge>{priceReviews.length}</Badge></div><div className="mt-5 divide-y border-y">{priceReviews.length ? priceReviews.map((item) => <div key={item.id} className="py-5"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{item.products?.name || item.product_id}</p><p className="mt-1 text-xs text-muted-foreground">{item.stores?.name || item.store_id} · {dateText(item.created_at)} · {item.note || "无备注"}</p></div><span className="font-mono font-semibold">{formatPrice(item.price_yen)}</span></div><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => reviewPrice(item.id, "approve")}>通过</Button><Button size="sm" variant="outline" onClick={() => reviewPrice(item.id, "reject")}>拒绝</Button></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">没有待审核价格。</p>}</div></section>
          <section><div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">扫码补录</p><h2 className="mt-1 text-2xl font-semibold">待审核商品</h2></div><Badge>{productReviews.length}</Badge></div><div className="mt-5 divide-y border-y">{productReviews.length ? productReviews.map((item) => <div key={item.id} className="py-5"><div><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.brand || "品牌未登记"} · JAN {item.barcode} · {item.pack || "规格未登记"}</p></div><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => reviewProduct(item.id, "approve")}>通过</Button><Button size="sm" variant="outline" onClick={() => reviewProduct(item.id, "reject")}>拒绝</Button></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">没有待审核商品。</p>}</div></section>
        </motion.div>}

        {tab === "products" && <div className="mt-10 grid gap-10 lg:grid-cols-[0.75fr_1.25fr]"><form onSubmit={saveProduct} className="rounded-2xl border bg-card p-6 lg:sticky lg:top-24 lg:self-start"><h2 className="text-xl font-semibold">{productForm.id ? "编辑商品" : "新增商品"}</h2><div className="mt-6 space-y-3"><Input value={productForm.id} onChange={(e) => setProductForm({ ...productForm, id: e.target.value })} placeholder="商品 ID（可与 JAN 相同）" /><Input value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} placeholder="JAN 码" required /><Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="商品名称" required /><Input value={productForm.brand} onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })} placeholder="品牌" /><div className="grid grid-cols-2 gap-3"><Input value={productForm.pack} onChange={(e) => setProductForm({ ...productForm, pack: e.target.value })} placeholder="规格" /><Input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="分类" /></div><Input value={productForm.image_url} onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })} placeholder="图片 URL" /><textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="商品说明" className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" /><div className="flex gap-2"><Button type="submit"><Save /> 保存</Button><Button type="button" variant="outline" onClick={() => setProductForm(blankProduct)}>清空</Button></div></div></form><section><h2 className="text-2xl font-semibold">商品库</h2><div className="mt-5 divide-y border-y">{products.map((item) => <div key={item.id} className="flex items-center gap-4 py-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.brand || "品牌未登记"} · {item.pack || "规格未登记"} · JAN {item.barcode}</p></div><Button size="sm" variant="ghost" onClick={() => setProductForm({ ...blankProduct, ...item })}>编辑</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove("product", item.id)}>删除</Button></div>)}</div></section></div>}

        {tab === "stores" && <div className="mt-10 grid gap-10 lg:grid-cols-[0.75fr_1.25fr]"><form onSubmit={saveStore} className="rounded-2xl border bg-card p-6 lg:sticky lg:top-24 lg:self-start"><h2 className="text-xl font-semibold">{storeForm.id ? "编辑门店" : "新增门店"}</h2><div className="mt-6 space-y-3"><Input value={storeForm.id} onChange={(e) => setStoreForm({ ...storeForm, id: e.target.value })} placeholder="门店 ID" /><Input value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} placeholder="门店名称" required /><Input value={storeForm.chain_name} onChange={(e) => setStoreForm({ ...storeForm, chain_name: e.target.value })} placeholder="连锁名" /><div className="grid grid-cols-2 gap-3"><Input value={storeForm.pref} onChange={(e) => setStoreForm({ ...storeForm, pref: e.target.value })} placeholder="都道府县" /><Input value={storeForm.city} onChange={(e) => setStoreForm({ ...storeForm, city: e.target.value })} placeholder="城市" /></div><Input value={storeForm.address} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} placeholder="地址" /><div className="grid grid-cols-2 gap-3"><Input type="number" step="any" value={storeForm.lat} onChange={(e) => setStoreForm({ ...storeForm, lat: e.target.value })} placeholder="纬度" required /><Input type="number" step="any" value={storeForm.lng} onChange={(e) => setStoreForm({ ...storeForm, lng: e.target.value })} placeholder="经度" required /></div><Input value={storeForm.hours} onChange={(e) => setStoreForm({ ...storeForm, hours: e.target.value })} placeholder="营业时间" /><div className="flex gap-2"><Button type="submit"><Save /> 保存</Button><Button type="button" variant="outline" onClick={() => setStoreForm(blankStore)}>清空</Button></div></div></form><section><h2 className="text-2xl font-semibold">门店库</h2><div className="mt-5 divide-y border-y">{stores.map((item) => <div key={item.id} className="flex items-center gap-4 py-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.chain_name || "独立门店"} · {[item.pref, item.city, item.address].filter(Boolean).join(" ")}</p></div><Button size="sm" variant="ghost" onClick={() => setStoreForm({ ...blankStore, ...item, lat: String(item.lat ?? ""), lng: String(item.lng ?? "") })}>编辑</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove("store", item.id)}>删除</Button></div>)}</div></section></div>}

        {tab === "prices" && <div className="mt-10 grid gap-10 lg:grid-cols-[0.75fr_1.25fr]"><form onSubmit={savePrice} className="rounded-2xl border bg-card p-6 lg:sticky lg:top-24 lg:self-start"><h2 className="text-xl font-semibold">录入门店价格</h2><div className="mt-6 space-y-3"><select value={priceForm.product_id} onChange={(e) => setPriceForm({ ...priceForm, product_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm" required><option value="">选择商品</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={priceForm.store_id} onChange={(e) => setPriceForm({ ...priceForm, store_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm" required><option value="">选择门店</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Input type="number" min="1" value={priceForm.price_yen} onChange={(e) => setPriceForm({ ...priceForm, price_yen: e.target.value })} placeholder="价格（日元）" required /><Input value={priceForm.note} onChange={(e) => setPriceForm({ ...priceForm, note: e.target.value })} placeholder="备注" /><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={priceForm.is_member_price} onChange={(e) => setPriceForm({ ...priceForm, is_member_price: e.target.checked })} /> 会员价</label><Button type="submit"><Save /> 保存价格</Button></div></form><section><h2 className="text-2xl font-semibold">最近价格</h2><div className="mt-5 divide-y border-y">{prices.map((item) => <div key={item.id} className="flex items-center gap-4 py-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.products?.name || item.product_id}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.stores?.name || item.store_id} · {dateText(item.collected_at)}</p></div><span className="font-mono font-semibold">{formatPrice(item.price_yen)}</span><Button size="sm" variant="ghost" onClick={() => setPriceForm({ ...blankPrice, ...item, price_yen: String(item.price_yen) })}>编辑</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove("price", item.id)}>删除</Button></div>)}</div></section></div>}

        {tab === "business" && <div className="mt-10 grid gap-12 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">调整用户积分</h2><p className="mt-2 text-sm text-muted-foreground">写入积分流水并即时更新余额。</p></div><Coins className="size-5 text-primary" /></div><form onSubmit={adjustCredits} className="mt-6 space-y-3"><select value={creditForm.user_id} onChange={(e) => setCreditForm({ ...creditForm, user_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm" required><option value="">选择用户</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.email || item.id}</option>)}</select><Input type="number" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} placeholder="增减积分，例如 10 或 -10" required /><Input value={creditForm.note} onChange={(e) => setCreditForm({ ...creditForm, note: e.target.value })} placeholder="调整原因" /><Button type="submit">调整积分</Button></form></section>
          <section className="rounded-2xl border bg-card p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">业务参数</h2><p className="mt-2 text-sm text-muted-foreground">仅可更新数据库允许的白名单键。</p></div><ShieldAlert className="size-5 text-primary" /></div><form onSubmit={saveSetting} className="mt-6 space-y-3"><select value={settingForm.setting_key} onChange={(e) => setSettingForm({ ...settingForm, setting_key: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{["daily_free_searches", "daily_free_price_references", "search_cost_after_free", "price_reference_cost", "approved_contribution_reward", "consensus_required_users", "consensus_window_days", "task_claim_limit_per_day", "task_expiry_hours", "stale_price_days", "low_balance_threshold"].map((key) => <option key={key}>{key}</option>)}</select><Input value={settingForm.setting_value} onChange={(e) => setSettingForm({ ...settingForm, setting_value: e.target.value })} placeholder="新值" required /><Button type="submit">更新参数</Button></form><pre className="mt-6 max-h-56 overflow-auto rounded-xl bg-muted p-4 text-xs">{JSON.stringify(settings, null, 2)}</pre></section>
          <section className="border-t pt-6 lg:col-span-2"><p className="text-sm text-muted-foreground">近 7 天</p><h2 className="mt-1 text-2xl font-semibold">遥测概览</h2><pre className="mt-5 overflow-auto rounded-xl bg-muted p-4 text-xs">{JSON.stringify(telemetry, null, 2)}</pre></section>
        </div>}
      </section>
    </AppShell>
  )
}
