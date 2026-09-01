import { motion } from "motion/react"
import { Activity, Boxes, Building2, Coins, PackageCheck, RefreshCw, Save, ShieldAlert, Tags } from "lucide-react"
import { useEffect, useState } from "react"

import AppShell, { AppLoading } from "@/components/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  adminAdjustCredits,
  adminBulkUpsertCommercialOffers,
  adminFetchAffiliateReports,
  adminDeletePrice,
  adminDeleteProduct,
  adminDeleteStore,
  adminFetchCommercialCandidates,
  adminFetchCommercialOffers,
  adminFetchMembershipReadiness,
  adminFetchPriceAlertSummary,
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
  adminUpsertCommercialOffer,
  adminUpsertAffiliateReport,
  fetchAppSettings,
  fetchCurrentProfile,
  fetchPendingPriceSubmissions,
  fetchProductSubmissions,
  fetchRecentPrices,
  friendlyApiError,
  getSession,
  parseCommercialOfferRows,
  recordTelemetryEvent,
  searchProducts,
  searchStores,
} from "@/lib/aprice-api.mjs"
import { formatPrice } from "@/lib/products.mjs"
import { appPath } from "@/lib/paths.mjs"

const blankProduct = { id: "", barcode: "", name: "", brand: "", pack: "", category: "", tone: "sunset", description: "", image_url: "" }
const blankStore = { id: "", name: "", chain_name: "", pref: "", city: "", address: "", lat: "", lng: "", hours: "" }
const blankPrice = { id: "", product_id: "", store_id: "", price_yen: "", is_member_price: false, source: "manual", note: "" }
const blankCommercialOffer = { id: "", product_id: "", store_id: "", partner: "rakuten", campaign: "", destination_url: "", is_active: false }
const blankAffiliateReport = { partner: "rakuten", period_start: "", period_end: "", result_status: "pending", clicks: "0", orders: "0", sales_yen: "0", commission_yen: "0", note: "" }
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
  const groups = [
    ["查价与行动", [
      ["会话", data.sessions], ["完整查价", data.price_query_sessions], ["空查价率", data.price_query_empty_percent, "%"],
      ["查价 → 行动", data.price_to_action_percent, "%"], ["完成比价", data.compare_completed_sessions], ["商业出口", data.commercial_outbound_sessions],
    ]],
    ["供给效率", [
      ["领取任务", data.tasks_claimed], ["提交任务", data.tasks_submitted], ["通过任务", data.tasks_approved],
      ["领取 → 提交", data.task_claim_to_submit_percent, "%"], ["领取 → 通过", data.task_claim_to_approval_percent, "%"],
    ]],
    ["留存与积分", [
      ["活跃用户", data.active_users], ["7 日内回访", data.seven_day_return_percent, "%"], ["收藏回访", data.favorite_revisits],
      ["积分发放", data.credits_issued], ["积分消耗", data.credits_spent],
    ]],
    ["登录转化", [
      ["匿名预览", data.preview_sessions], ["登录成功", data.login_completed_sessions],
      ["预览 → 登录意图", data.preview_to_login_intent_percent, "%"], ["预览 → 登录成功", data.preview_to_login_percent, "%"],
    ]],
  ]
  return <motion.div key={data.days || 7} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-7 space-y-8">{groups.map(([title, metrics]) => <section key={title}><h3 className="text-sm font-semibold">{title}</h3><div className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">{metrics.map(([label, value, suffix = ""]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}{suffix}</p></div>)}</div></section>)}</motion.div>
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
  const sources = Array.isArray(data.price_sources) ? data.price_sources : []

  return <section className="border-t pt-6 lg:col-span-2">
    <p className="text-sm text-muted-foreground">近 {data.days || 30} 天 · 普通价（实体与在线来源）</p>
    <h2 className="mt-1 text-2xl font-semibold">价格覆盖健康度</h2>
    <p className="mt-2 text-sm text-muted-foreground">优先补齐没有有效报价的商品，并持续降低过期报价比例。</p>
    {enabled ? <>
      <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">{metrics.map(([label, value, suffix = ""]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}{suffix}</p></div>)}</div>
      <div className="mt-8"><div className="flex items-end justify-between gap-4"><div><h3 className="font-semibold">价格源运行状态</h3><p className="mt-1 text-xs text-muted-foreground">超过 8 天没有新采样会标记为过期</p></div><span className="font-mono text-sm text-muted-foreground">{sources.length} 个来源</span></div><div className="mt-3 divide-y border-y">{sources.length ? sources.map((source) => <div key={`${source.source}-${source.store_id}`} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{source.store_name}</p><Badge variant={source.is_stale ? "outline" : "default"}>{source.is_stale ? "已过期" : "运行正常"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{source.source} · 最后采样 {dateText(source.last_collected_at)}</p></div><div className="text-right"><p className="font-mono font-semibold">{source.recent_product_count ?? 0} 件商品</p><p className="mt-1 text-xs text-muted-foreground">{source.recent_snapshot_count ?? 0} 条近期快照</p></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">暂无价格源记录。</p>}</div></div>
      <div className="mt-8"><div className="flex items-end justify-between gap-4"><div><h3 className="font-semibold">优先补价商品</h3><p className="mt-1 text-xs text-muted-foreground">按当前窗口没有任何有效门店报价</p></div><span className="font-mono text-sm text-muted-foreground">{data.products_without_fresh_price ?? 0} 件</span></div><div className="mt-3 divide-y border-y">{needsPrices.length ? needsPrices.map((item) => <button type="button" key={item.id} onClick={() => onOpenProduct(item)} className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="block truncate font-medium">{item.name || item.id}</span><span className="mt-1 block truncate text-xs text-muted-foreground">JAN {item.barcode || "未登记"}</span></span><span className="shrink-0 text-xs text-muted-foreground">查看商品</span></button>) : <p className="py-8 text-center text-sm text-muted-foreground">当前窗口内所有商品均有有效报价。</p>}</div></div>
    </> : <div className="mt-5 border-y py-8"><p className="font-medium">价格健康度尚未启用</p><p className="mt-1 text-sm text-muted-foreground">执行已准备的数据库迁移后，这里会自动显示覆盖指标。</p></div>}
  </section>
}

function PriceAlertHealth({ data = {} }) {
  const enabled = Number.isFinite(Number(data.active_alerts))
  const failures = Array.isArray(data.recent_failures) ? data.recent_failures : []
  const metrics = [
    ["活跃提醒", data.active_alerts],
    ["等待发送", data.queued_deliveries],
    ["正在重试", data.retrying_deliveries],
    [`${data.days || 7} 天已发送`, data.sent_deliveries],
    ["发送成功率", data.delivery_success_percent, "%"],
  ]

  return <section className="border-t pt-6 lg:col-span-2">
    <p className="text-sm text-muted-foreground">通知运营</p>
    <h2 className="mt-1 text-2xl font-semibold">降价提醒发送健康度</h2>
    <p className="mt-2 text-sm text-muted-foreground">终止失败 {data.terminal_failures ?? 0} 条；失败任务最多自动尝试 5 次。</p>
    {enabled ? <><div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">{metrics.map(([label, value, suffix = ""]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}{suffix}</p></div>)}</div>{failures.length > 0 && <div className="mt-8"><h3 className="font-semibold">最近失败</h3><div className="mt-3 divide-y border-y">{failures.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4"><div className="min-w-0"><p className="truncate font-medium">{item.product_name || item.product_id}</p><p className="mt-1 max-w-3xl break-words text-xs text-muted-foreground">{item.error_message || "未知发送错误"}</p></div><div className="shrink-0 text-right text-xs text-muted-foreground"><Badge variant="outline">{item.will_retry ? "等待重试" : "已终止"}</Badge><p className="mt-2">第 {item.attempt_count} 次 · {dateText(item.created_at)}</p></div></div>)}</div></div>}</> : <div className="mt-5 border-y py-8"><p className="font-medium">发送健康度尚未启用</p><p className="mt-1 text-sm text-muted-foreground">执行管理员汇总迁移后，这里会显示提醒与失败状态。</p></div>}
  </section>
}

function CommercialCoverageSummary({ offers = [] }) {
  const activeOffers = offers.filter((offer) => offer.is_active)
  const productCoverage = new Set(activeOffers.map((offer) => String(offer.product_id))).size
  const clicks = offers.reduce((total, offer) => total + (Number(offer.click_count) || 0), 0)
  const metrics = [["商品覆盖目标", `${productCoverage}/50`], ["启用链接", activeOffers.length], ["归因点击", clicks]]

  return <section className="border-t pt-6 lg:col-span-2"><p className="text-sm text-muted-foreground">商业验收</p><h2 className="mt-1 text-2xl font-semibold">联盟验证进度</h2><p className="mt-2 text-sm text-muted-foreground">先覆盖 50 件热门商品，再根据归因点击判断是否继续扩大。</p><div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-3">{metrics.map(([label, value]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value}</p></div>)}</div></section>
}

function CommercialCandidates({ items = [], onSelect }) {
  return <section className="border-t pt-6 lg:col-span-2"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">近 90 天行为优先 + 近期有价核心品类补足</p><h2 className="mt-1 text-2xl font-semibold">商业商品候选</h2><p className="mt-2 text-sm text-muted-foreground">先处理真实浏览、查价和收藏商品；0 个价格来源表示需要先补价。</p></div><span className="font-mono text-sm text-muted-foreground">{items.length}/50 件</span></div><div className="mt-5 max-h-[34rem] divide-y overflow-auto border-y">{items.length ? items.map((item, index) => <div key={item.product_id} className="flex flex-wrap items-center gap-4 py-4"><span className="w-7 shrink-0 font-mono text-sm text-muted-foreground">{index + 1}</span><div className="min-w-48 flex-1"><p className="truncate font-medium">{item.product_name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.brand || "品牌未登记"} · JAN {item.barcode || "未登记"}</p></div><div className="text-right text-xs text-muted-foreground"><p><span className="font-mono font-semibold text-foreground">{item.interest_score ?? 0}</span> 意向分</p><p className="mt-1">浏览 {item.product_views ?? 0} · 查价 {item.price_queries ?? 0} · 收藏 {item.favorite_count ?? 0}</p></div><div className="w-24 text-right"><p className="font-mono font-semibold">{formatPrice(item.minimum_price_yen)}</p><p className="mt-1 text-xs text-muted-foreground">{item.price_source_count ?? 0} 个来源</p></div><Button size="sm" variant="outline" onClick={() => onSelect(item)}>配置链接</Button></div>) : <p className="py-10 text-center text-sm text-muted-foreground">暂无符合条件的候选商品。</p>}</div></section>
}

function CommercialBulkImport({ onImport }) {
  const [partner, setPartner] = useState("rakuten")
  const [campaign, setCampaign] = useState("")
  const [rows, setRows] = useState("")
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState("")

  const submit = async (event) => {
    event.preventDefault()
    let items
    try { items = parseCommercialOfferRows(rows) } catch (parseError) { setError(parseError.message); return }
    setError("")
    if (await onImport({ partner, campaign, is_active: isActive, items })) setRows("")
  }

  return <details className="border-t pt-6 lg:col-span-2"><summary className="cursor-pointer font-semibold">批量导入商业链接</summary><p className="mt-2 text-sm text-muted-foreground">每行粘贴“商品 ID + 空格或 Tab + HTTPS 联盟链接”；相同商品和合作方会更新。</p><form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="合作方"><Input value={partner} onChange={(event) => setPartner(event.target.value)} pattern="[a-z0-9_-]{2,40}" required /></Field><Field label="Campaign"><Input value={campaign} onChange={(event) => setCampaign(event.target.value)} maxLength={100} /></Field><label className="sm:col-span-2"><span className="mb-2 block text-sm font-medium">商品 ID 与链接</span><textarea value={rows} onChange={(event) => setRows(event.target.value)} className="min-h-40 w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" placeholder={"4987240210535\thttps://affiliate.example/item\n4560309833212\thttps://affiliate.example/item-2"} required /></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> 导入后立即启用</label><div className="flex items-center justify-end"><Button type="submit"><Save />批量保存</Button></div>{error && <p className="text-sm text-destructive sm:col-span-2" role="alert">{error}</p>}</form></details>
}

function MembershipReadiness({ data = {} }) {
  const enabled = Number.isFinite(Number(data.active_users))
  const metrics = [
    ["7 日回访率", data.seven_day_return_percent, "15%"],
    ["重复查价用户", data.repeat_price_query_users, "10 人"],
    ["重复查价占比", data.repeat_price_query_percent, "20%"],
  ]

  return <section className="border-t pt-6 lg:col-span-2"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">近 {data.days || 30} 天</p><h2 className="mt-1 text-2xl font-semibold">会员功能决策门槛</h2><p className="mt-2 text-sm text-muted-foreground">重复查价指登录用户在至少两个不同日期成功查询价格。</p></div>{enabled && <Badge variant={data.membership_ready ? "default" : "outline"}>{data.membership_ready ? "可以进入方案设计" : "继续验证留存"}</Badge>}</div>{enabled ? <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-3">{metrics.map(([label, value, target]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}{label.includes("率") || label.includes("占比") ? "%" : ""}</p><p className="mt-1 text-xs text-muted-foreground">门槛 {target}</p></div>)}</div> : <div className="mt-5 border-y py-8"><p className="font-medium">会员决策指标尚未启用</p><p className="mt-1 text-sm text-muted-foreground">执行准备好的数据库迁移后再判断，不提前建设支付系统。</p></div>}</section>
}

function AffiliateReportWorkspace({ data = {}, form, setForm, onSave }) {
  const items = Array.isArray(data.items) ? data.items : []
  const statusLabel = { pending: "未确定", confirmed: "已确定", discarded: "已作废" }
  const metrics = [["确定订单", data.confirmed_orders], ["确定销售额", formatPrice(data.confirmed_sales_yen || 0)], ["确定佣金", formatPrice(data.confirmed_commission_yen || 0)], ["待确定佣金", formatPrice(data.pending_commission_yen || 0)]]

  return <section className="border-t pt-6 lg:col-span-2"><p className="text-sm text-muted-foreground">楽天官方成果报表</p><h2 className="mt-1 text-2xl font-semibold">成交与佣金</h2><p className="mt-2 text-sm text-muted-foreground">按报表周期录入汇总值；相同合作方、周期和状态会直接更新。</p><div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="border-t pt-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value ?? 0}</p></div>)}</div><div className="mt-8 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]"><form onSubmit={onSave} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="开始日期"><Input type="date" value={form.period_start} onChange={(event) => setForm({ ...form, period_start: event.target.value })} required /></Field><Field label="结束日期"><Input type="date" value={form.period_end} onChange={(event) => setForm({ ...form, period_end: event.target.value })} required /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="合作方"><Input value={form.partner} onChange={(event) => setForm({ ...form, partner: event.target.value })} pattern="[a-z0-9_-]{2,40}" required /></Field><Field label="成果状态"><select value={form.result_status} onChange={(event) => setForm({ ...form, result_status: event.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm"><option value="pending">未确定</option><option value="confirmed">已确定</option><option value="discarded">已作废</option></select></Field></div><div className="grid grid-cols-2 gap-4">{[["点击", "clicks"], ["订单", "orders"], ["销售额（日元）", "sales_yen"], ["佣金（日元）", "commission_yen"]].map(([label, key]) => <Field key={key} label={label}><Input type="number" min="0" step="1" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required /></Field>)}</div><Field label="备注"><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} maxLength={500} /></Field><Button type="submit"><Save /> 保存周期汇总</Button></form><div className="divide-y border-y">{items.length ? items.map((item) => <button type="button" key={item.id} onClick={() => setForm({ partner: item.partner, period_start: item.period_start, period_end: item.period_end, result_status: item.result_status, clicks: String(item.clicks), orders: String(item.orders), sales_yen: String(item.sales_yen), commission_yen: String(item.commission_yen), note: item.note || "" })} className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left transition-colors hover:text-primary"><span className="min-w-0"><span className="block font-medium">{item.period_start} ～ {item.period_end}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.partner} · {statusLabel[item.result_status] || item.result_status} · {item.orders} 单</span></span><span className="shrink-0 text-right"><span className="block font-mono font-semibold">{formatPrice(item.commission_yen)}</span><span className="mt-1 block text-xs text-muted-foreground">佣金</span></span></button>) : <p className="py-10 text-center text-sm text-muted-foreground">尚未录入成果报表。</p>}</div></div></section>
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
  const [telemetryDays, setTelemetryDays] = useState(7)
  const [telemetryLoading, setTelemetryLoading] = useState(false)
  const [priceHealth, setPriceHealth] = useState({})
  const [priceAlertHealth, setPriceAlertHealth] = useState({})
  const [membershipReadiness, setMembershipReadiness] = useState({})
  const [affiliateReports, setAffiliateReports] = useState({})
  const [commercialOffers, setCommercialOffers] = useState([])
  const [commercialCandidates, setCommercialCandidates] = useState([])
  const [productForm, setProductForm] = useState(blankProduct)
  const [storeForm, setStoreForm] = useState(blankStore)
  const [priceForm, setPriceForm] = useState(blankPrice)
  const [commercialForm, setCommercialForm] = useState(blankCommercialOffer)
  const [affiliateReportForm, setAffiliateReportForm] = useState(blankAffiliateReport)
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
        searchProducts("", 500, { curated: false }), searchStores("", 500), fetchRecentPrices(100), fetchPendingPriceSubmissions(100), fetchProductSubmissions(100), adminFetchProfiles(100), fetchAppSettings(), adminFetchTelemetrySummary({ days: telemetryDays }), adminFetchTelemetryRecent({ limit: 30 }), adminFetchPriceHealth({ days: 30, limit: 20 }), adminFetchCommercialOffers(), adminFetchPriceAlertSummary({ days: 7 }), adminFetchMembershipReadiness({ days: 30 }), adminFetchAffiliateReports({ days: 180 }), adminFetchCommercialCandidates({ days: 90, limit: 50 }),
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
      setCommercialOffers(value(10, silent ? commercialOffers : []))
      setPriceAlertHealth(value(11, silent ? priceAlertHealth : {}))
      setMembershipReadiness(value(12, silent ? membershipReadiness : {}))
      setAffiliateReports(value(13, silent ? affiliateReports : {}))
      setCommercialCandidates(value(14, silent ? commercialCandidates : []))
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
  const reviewPrice = async (id, action) => {
    if (!window.confirm(`确认${action === "approve" ? "通过" : "拒绝"}这条价格提交？`)) return
    if (await act(() => adminReviewPriceSubmission(id, action), "价格审核已完成。") && action === "approve") void recordTelemetryEvent("task_approved", { submission_type: "price" }).catch(() => {})
  }
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
  const saveCommercialOffer = async (event) => {
    event.preventDefault()
    if (await act(() => adminUpsertCommercialOffer(commercialForm), "商业链接已保存。")) setCommercialForm(blankCommercialOffer)
  }
  const importCommercialOffers = (payload) => act(() => adminBulkUpsertCommercialOffers(payload), `已批量保存 ${payload.items.length} 条商业链接。`)
  const saveAffiliateReport = async (event) => {
    event.preventDefault()
    const numeric = Object.fromEntries(["clicks", "orders", "sales_yen", "commission_yen"].map((key) => [key, Number(affiliateReportForm[key])]))
    if (affiliateReportForm.period_end < affiliateReportForm.period_start || Object.values(numeric).some((value) => !Number.isInteger(value) || value < 0)) { setStatus("请检查报表周期与非负整数金额。"); return }
    if (await act(() => adminUpsertAffiliateReport({ ...affiliateReportForm, ...numeric }), "联盟成果汇总已保存。")) setAffiliateReportForm(blankAffiliateReport)
  }
  const toggleCommercialOffer = (offer) => act(() => adminUpsertCommercialOffer({ ...offer, is_active: !offer.is_active }), offer.is_active ? "商业链接已停用。" : "商业链接已启用。")
  const selectCommercialCandidate = (candidate) => {
    setProducts((items) => items.some((item) => item.id === candidate.product_id) ? items : [{ id: candidate.product_id, name: candidate.product_name }, ...items])
    setCommercialForm({ ...blankCommercialOffer, product_id: candidate.product_id })
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
  const changeTelemetryWindow = async (days) => {
    if (telemetryLoading || days === telemetryDays) return
    setTelemetryLoading(true)
    try { setTelemetry(await adminFetchTelemetrySummary({ days })); setTelemetryDays(days) } catch (error) { setStatus(friendlyApiError(error)) } finally { setTelemetryLoading(false) }
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
    ["通知终止失败", priceAlertHealth.terminal_failures ?? 0, "business"],
  ]
  return (
    <AppShell title="管理工作台" description="审核提交并维护业务数据。" session={session} profile={profile} actions={<Button variant="outline" onClick={() => act(() => Promise.resolve(), "数据已刷新。")} disabled={busy}><RefreshCw className={busy ? "animate-spin" : ""} /> 刷新</Button>}>
      <section className={`mx-auto max-w-[1320px] px-4 pb-24 transition-opacity sm:px-6 lg:px-8 ${busy ? "pointer-events-none opacity-70" : ""}`} aria-busy={busy}>
        <nav className="flex snap-x gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5 shadow-sm" role="tablist" aria-label="管理功能">{tabs.map(([value, label, Icon]) => <Button key={value} id={`admin-tab-${value}`} role="tab" className="shrink-0 snap-start rounded-xl" variant={tab === value ? "default" : "ghost"} onClick={() => setTab(value)} aria-selected={tab === value} aria-controls={`admin-panel-${value}`}><Icon /> {label}</Button>)}</nav>
        {status && <div className="mt-6 rounded-xl border bg-card px-4 py-3 text-sm" role="status">{status}</div>}
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-b pb-8 lg:grid-cols-5" aria-label="运营待办概览">{operations.map(([label, value, target]) => <button type="button" key={label} onClick={() => setTab(target)} className="min-h-16 border-t pt-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block text-xs text-muted-foreground">{label}</span><span className="mt-1 block font-mono text-2xl font-semibold">{value}</span></button>)}</div>

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
          <CommercialCoverageSummary offers={commercialOffers} />
          <CommercialCandidates items={commercialCandidates} onSelect={selectCommercialCandidate} />
          <CommercialBulkImport onImport={importCommercialOffers} />
          <section className="border-t pt-6 lg:col-span-2"><div><p className="text-sm text-muted-foreground">楽天联盟 MVP</p><h2 className="mt-1 text-2xl font-semibold">商业链接</h2><p className="mt-2 text-sm text-muted-foreground">仅启用已核对商品与目标地址的链接；点击数来自服务端归因记录。</p></div><div className="mt-7 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]"><form onSubmit={saveCommercialOffer} className="space-y-4 lg:sticky lg:top-24 lg:self-start"><Field label="商品"><select value={commercialForm.product_id} onChange={(e) => setCommercialForm({ ...commercialForm, product_id: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" required><option value="">选择商品</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="门店（可选）"><select value={commercialForm.store_id} onChange={(e) => setCommercialForm({ ...commercialForm, store_id: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 text-sm"><option value="">不限门店</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="合作方"><Input value={commercialForm.partner} onChange={(e) => setCommercialForm({ ...commercialForm, partner: e.target.value })} pattern="[a-z0-9_-]{2,40}" required /></Field><Field label="Campaign"><Input value={commercialForm.campaign} onChange={(e) => setCommercialForm({ ...commercialForm, campaign: e.target.value })} maxLength={100} /></Field></div><Field label="HTTPS 跳转地址"><Input type="url" value={commercialForm.destination_url} onChange={(e) => setCommercialForm({ ...commercialForm, destination_url: e.target.value })} pattern="https://.*" required /></Field><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={commercialForm.is_active} onChange={(e) => setCommercialForm({ ...commercialForm, is_active: e.target.checked })} /> 保存后立即启用</label><div className="flex gap-2"><Button type="submit"><Save />{commercialForm.id ? "保存修改" : "新增链接"}</Button>{commercialForm.id && <Button type="button" variant="outline" onClick={() => setCommercialForm(blankCommercialOffer)}>取消编辑</Button>}</div></form><div className="divide-y border-y">{commercialOffers.length ? commercialOffers.map((offer) => <div key={offer.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{offer.product_name || offer.product_id}</p><Badge variant={offer.is_active ? "default" : "outline"}>{offer.is_active ? "已启用" : "已停用"}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{offer.partner} · {offer.campaign || "无 campaign"} · {offer.store_name || "不限门店"}</p><p className="mt-1 font-mono text-xs text-muted-foreground">点击 {offer.click_count ?? 0}</p></div><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setCommercialForm({ ...blankCommercialOffer, ...offer })}>编辑</Button><Button size="sm" variant="outline" onClick={() => toggleCommercialOffer(offer)}>{offer.is_active ? "停用" : "启用"}</Button></div></div></div>) : <p className="py-10 text-center text-sm text-muted-foreground">还没有商业链接。</p>}</div></div></section>
          <PriceHealthSummary data={priceHealth} onOpenProduct={openProduct} />
          <AffiliateReportWorkspace data={affiliateReports} form={affiliateReportForm} setForm={setAffiliateReportForm} onSave={saveAffiliateReport} />
          <PriceAlertHealth data={priceAlertHealth} />
          <MembershipReadiness data={membershipReadiness} />
          <section className="border-t pt-6 lg:col-span-2"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">近 {telemetry.days || telemetryDays} 天</p><h2 className="mt-1 text-2xl font-semibold">商业与供给漏斗</h2><p className="mt-2 text-sm text-muted-foreground">会话转化按匿名会话去重，任务与积分按窗口内业务流水统计。</p></div><div className="flex gap-1" aria-label="商业漏斗统计窗口">{[7, 30, 90].map((days) => <Button key={days} size="sm" variant={telemetryDays === days ? "default" : "ghost"} aria-pressed={telemetryDays === days} disabled={telemetryLoading} onClick={() => changeTelemetryWindow(days)}>{days} 天</Button>)}</div></div><TelemetrySummary data={telemetry} /><div className="mt-10"><h3 className="font-semibold">最近事件</h3><div className="mt-3 divide-y border-y">{telemetryRecent.length ? telemetryRecent.slice(0, 12).map((item, index) => <div key={item.id || `${item.event_name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="font-medium">{item.event_name || "unknown"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.email || item.user_id || "anonymous"} · {dateText(item.occurred_at)}</p></div><code className="max-w-full truncate text-xs text-muted-foreground">{JSON.stringify(item.payload || {})}</code></div>) : <p className="py-8 text-center text-sm text-muted-foreground">暂无最近事件。</p>}</div></div></section>
        </div>}
      </section>
    </AppShell>
  )
}
