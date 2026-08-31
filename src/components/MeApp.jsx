import { motion } from "motion/react"
import { ListChecks, LoaderCircle, LogOut, Save, SkipForward, Sparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import AppShell, { AppLoading } from "@/components/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  changePassword,
  claimRandomPriceTask,
  clearRecentViews,
  fetchCreditLedger,
  fetchCreditSummary,
  fetchCurrentProfile,
  fetchActivePriceTask,
  fetchFavorites,
  fetchMyProductSubmissions,
  fetchPersonalLogs,
  fetchRecentViews,
  friendlyApiError,
  getSession,
  recordTelemetryEvent,
  savePersonalLog,
  searchProducts,
  searchStores,
  signOut,
  skipPriceTask,
  toggleFavorite,
} from "@/lib/aprice-api.mjs"
import { formatPrice } from "@/lib/products.mjs"
import { appPath } from "@/lib/paths.mjs"

const formatDate = (value, withTime = false) => {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" }).format(date)
    : "未知"
}
const panelClass = "rounded-2xl border bg-card p-5 sm:p-6"
const listClass = "mt-5 divide-y border-t"
const rowClass = "flex items-center justify-between gap-4 py-4 transition-colors hover:bg-muted/35"

export default function MeApp() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [logs, setLogs] = useState([])
  const [favorites, setFavorites] = useState([])
  const [credit, setCredit] = useState(null)
  const [ledger, setLedger] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [recentViews, setRecentViews] = useState([])
  const [task, setTask] = useState(null)
  const [dataTab, setDataTab] = useState("logs")
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("")
  const [savingLog, setSavingLog] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [taskBusy, setTaskBusy] = useState(false)
  const [productSearch, setProductSearch] = useState("")
  const [storeSearch, setStoreSearch] = useState("")
  const [logForm, setLogForm] = useState({ product_id: "", store_id: "", price_yen: "", note: "" })
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" })

  const load = async () => {
    setLoading(true)
    setRecentViews(fetchRecentViews())
    try {
      const activeSession = await getSession()
      setSession(activeSession)
      if (!activeSession) return
      const results = await Promise.allSettled([
        fetchCurrentProfile(), searchProducts("", 500, { curated: false }), searchStores("", 500), fetchPersonalLogs(activeSession.user.id), fetchFavorites(activeSession.user.id), fetchCreditSummary(), fetchCreditLedger(30), fetchMyProductSubmissions(activeSession.user.id), fetchActivePriceTask(),
      ])
      const value = (index, fallback) => results[index].status === "fulfilled" ? results[index].value : fallback
      setProfile(value(0, { id: activeSession.user.id, email: activeSession.user.email, role: "user" }))
      setProducts(value(1, []))
      setStores(value(2, []))
      setLogs(value(3, []))
      setFavorites(value(4, []))
      setCredit(value(5, null))
      setLedger(value(6, []))
      setSubmissions(value(7, []))
      setTask(value(8, null))
      if (results.some(({ status }) => status === "rejected")) setStatus("部分账户数据暂时无法加载，请刷新页面重试。")
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const productNames = useMemo(() => new Map(products.map((item) => [String(item.id), item.name])), [products])
  const storeNames = useMemo(() => new Map(stores.map((item) => [String(item.id), item.name])), [stores])
  const filteredProducts = useMemo(() => {
    const needle = productSearch.trim().normalize("NFKC").toLocaleLowerCase("ja-JP")
    return needle ? products.filter((item) => [item.name, item.brand, item.barcode].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP").includes(needle)) : products
  }, [productSearch, products])
  const filteredStores = useMemo(() => {
    const needle = storeSearch.trim().normalize("NFKC").toLocaleLowerCase("ja-JP")
    return needle ? stores.filter((item) => [item.name, item.chain_name, item.pref, item.city, item.address].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP").includes(needle)) : stores
  }, [storeSearch, stores])

  const saveLog = async (event) => {
    event.preventDefault()
    if (savingLog) return
    setSavingLog(true)
    try {
      await savePersonalLog({ ...logForm, price_yen: Number(logForm.price_yen), store_id: logForm.store_id || null, purchased_at: new Date().toISOString().slice(0, 10) })
      setLogForm({ product_id: "", store_id: "", price_yen: "", note: "" })
      setLogs(await fetchPersonalLogs(session.user.id))
      setStatus("价格记录已保存。")
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setSavingLog(false) }
  }

  const removeFavorite = async (item) => {
    try {
      await toggleFavorite(item.entity_type, item.entity_id)
      setFavorites((rows) => rows.filter((row) => row.id !== item.id))
      setStatus("收藏已移除。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const claimTask = async () => {
    if (taskBusy) return
    setTaskBusy(true)
    try {
      const nextTask = await claimRandomPriceTask()
      setTask(nextTask)
      if (nextTask) void recordTelemetryEvent("task_claimed", { product_id: nextTask.product_id, has_store: Boolean(nextTask.store_id) }).catch(() => {})
      setStatus(nextTask ? "已领取补价任务。" : "当前没有可领取的补价任务。")
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setTaskBusy(false) }
  }

  const skipTask = async () => {
    if (taskBusy) return
    setTaskBusy(true)
    try { await skipPriceTask(task.id); setTask(null); setStatus("已跳过当前任务。") } catch (error) { setStatus(friendlyApiError(error)) } finally { setTaskBusy(false) }
  }

  const updateAccountPassword = async (event) => {
    event.preventDefault()
    if (savingPassword) return
    if (passwordForm.next.length < 8 || passwordForm.next !== passwordForm.confirm) { setStatus("新密码至少 8 位，且两次输入必须一致。"); return }
    setSavingPassword(true)
    try {
      await changePassword(passwordForm.current, passwordForm.next)
      setPasswordForm({ current: "", next: "", confirm: "" })
      setStatus("密码已更新。")
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setSavingPassword(false) }
  }

  const logout = async () => { await signOut(); window.location.assign(appPath("/")) }

  const dataTabs = [
    ["logs", "价格记录", logs.length],
    ["recent", "最近浏览", recentViews.length],
    ["favorites", "收藏", favorites.length],
    ["credits", "积分", ledger.length],
    ["submissions", "商品提交", submissions.length],
  ]
  const dataInfo = {
    logs: ["价格记录", "个人记录仅自己可见。"],
    recent: ["最近浏览", "保存在当前设备。"],
    favorites: ["收藏", "快速返回常看的商品与门店。"],
    credits: ["积分流水", "查询消耗与贡献奖励记录。"],
    submissions: ["商品提交", "查看扫码补录的审核进度。"],
  }
  const dataCompareIds = (dataTab === "recent" ? recentViews.map(({ id }) => id) : dataTab === "favorites" ? favorites.filter(({ entity_type }) => entity_type === "product").map(({ entity_id }) => entity_id) : []).slice(0, 6)
  const dataCompareHref = dataCompareIds.length ? appPath(`/?compare=${dataCompareIds.map((id) => encodeURIComponent(id)).join(",")}&compare_source=account`) : ""
  const paidPriceQueriesStarted = Number(credit?.references_today) >= Number(credit?.daily_free_price_references)
  const needsCredits = paidPriceQueriesStarted && Number(credit?.balance) < Number(credit?.price_reference_cost)
  const reviewLabels = { pending: "待审核", approved: "已通过", rejected: "未通过" }

  if (loading) return <AppShell title="个人中心"><AppLoading label="正在同步账户" /></AppShell>
  if (!session) return <AppShell eyebrow="个人中心" title="登录后管理自己的价格。" description="收藏、记录、额度和任务会同步到你的 AAPRICE 账号。"><div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6 lg:px-8"><Button asChild><a href={appPath(`/login/?redirect=${encodeURIComponent(appPath("/me/"))}`)}>登录或注册</a></Button></div></AppShell>

  return (
    <AppShell title={profile?.full_name || "我的账户"} description={session.user.email} session={session} profile={profile} actions={<Button variant="outline" onClick={logout}><LogOut /> 退出登录</Button>}>
      <section className="mx-auto max-w-[1320px] px-4 pb-24 sm:px-6 lg:px-8">
        {status && <div className="mb-6 rounded-2xl border bg-card px-4 py-3 text-sm shadow-sm" role="status">{status}</div>}

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 border-b pb-8 sm:grid-cols-3">
          {[["积分余额", credit?.balance ?? 0], ["价格记录", logs.length], ["收藏", favorites.length]].map(([label, value]) => <div key={label} className="rounded-2xl bg-muted/60 p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value}</p></div>)}
        </motion.div>

        {(task || needsCredits || recentViews.length > 1) && <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4 text-sm"><p>{task ? "你有一项进行中的补价任务。" : needsCredits ? "查价积分不足，可通过补价任务获得积分。" : "继续比较最近浏览的商品。"}</p>{task || needsCredits ? <Button asChild size="sm" variant="outline"><a href="#price-tasks">{task ? "继续任务" : "获取积分"}</a></Button> : <Button size="sm" variant="outline" onClick={() => setDataTab("recent")}>查看最近浏览</Button>}</div>}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)] lg:items-start">
          <div className="min-w-0 space-y-5 lg:sticky lg:top-24">
            <motion.section id="quick-log" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className={`${panelClass} scroll-mt-24`}>
              <div><h2 className="text-xl font-semibold">快速记录价格</h2><p className="mt-1 text-sm text-muted-foreground">选择商品并输入价格即可。</p></div>
              <form onSubmit={saveLog} className="mt-6 space-y-4">
                <label><span className="mb-2 block text-sm font-medium">搜索商品</span><Input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="商品名、品牌或 JAN 码" /></label>
                <label><span className="mb-2 block text-sm font-medium">商品</span><select value={logForm.product_id} onChange={(event) => setLogForm({ ...logForm, product_id: event.target.value })} className="h-11 w-full rounded-xl border bg-background px-3 text-sm" required><option value="">选择商品</option>{filteredProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span className="mb-2 block text-sm font-medium">价格（日元）</span><Input type="number" min="1" value={logForm.price_yen} onChange={(event) => setLogForm({ ...logForm, price_yen: event.target.value })} required /></label>
                <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-muted-foreground">门店与备注（可选）</summary><div className="mt-2 space-y-4"><label><span className="mb-2 block text-sm font-medium">搜索门店</span><Input type="search" value={storeSearch} onChange={(event) => setStoreSearch(event.target.value)} placeholder="店名、连锁、城市或地址" /></label><label><span className="mb-2 block text-sm font-medium">门店</span><select value={logForm.store_id} onChange={(event) => setLogForm({ ...logForm, store_id: event.target.value })} className="h-11 w-full rounded-xl border bg-background px-3 text-sm"><option value="">不指定门店</option>{filteredStores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="mb-2 block text-sm font-medium">备注</span><Input value={logForm.note} onChange={(event) => setLogForm({ ...logForm, note: event.target.value })} placeholder="促销、会员价等" /></label></div></details>
                <Button type="submit" className="w-full" disabled={savingLog}>{savingLog ? <LoaderCircle className="animate-spin" /> : <Save />}{savingLog ? "正在保存" : "保存记录"}</Button>
              </form>
            </motion.section>

            <section id="price-tasks" className={`${panelClass} scroll-mt-24`}>
              <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">随机补价任务</h2><p className="mt-1 text-sm text-muted-foreground">审核通过后获得 {credit?.approved_contribution_reward ?? 0} 积分。</p></div><ListChecks className="size-5 text-primary" /></div>
              {task ? <div className="mt-5 rounded-2xl bg-muted p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{productNames.get(String(task.product_id)) || task.product_id}</p><p className="mt-1 text-sm text-muted-foreground">{storeNames.get(String(task.store_id)) || task.store_id || "任意门店"}</p></div><Badge variant="outline">进行中</Badge></div>{task.expires_at && <p className="mt-3 text-xs text-muted-foreground">有效期至 {formatDate(task.expires_at, true)}</p>}<div className="mt-4 flex gap-2"><Button asChild size="sm"><a href={appPath(`/product/?id=${encodeURIComponent(task.product_id)}&task=1${task.store_id ? `&store=${encodeURIComponent(task.store_id)}` : ""}#record-price`)}>记录这个价格</a></Button><Button size="sm" variant="outline" onClick={skipTask} disabled={taskBusy}>{taskBusy ? <LoaderCircle className="animate-spin" /> : <SkipForward />} {taskBusy ? "处理中" : "跳过"}</Button></div></div> : <Button className="mt-5" variant="outline" onClick={claimTask} disabled={taskBusy}>{taskBusy ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {taskBusy ? "领取中" : "领取随机任务"}</Button>}
            </section>

            <details className={panelClass}>
              <summary className="cursor-pointer font-semibold">修改密码</summary>
              <form onSubmit={updateAccountPassword} className="mt-5 space-y-3">{[["当前密码", "current"], ["新密码", "next"], ["确认新密码", "confirm"]].map(([label, key]) => <label key={key}><span className="mb-2 block text-sm font-medium">{label}</span><Input type="password" value={passwordForm[key]} onChange={(event) => setPasswordForm({ ...passwordForm, [key]: event.target.value })} required disabled={savingPassword} /></label>)}<Button type="submit" variant="outline" className="w-full" disabled={savingPassword}>{savingPassword && <LoaderCircle className="animate-spin" />}{savingPassword ? "正在更新" : "更新密码"}</Button></form>
            </details>
          </div>

          <section className={`${panelClass} min-w-0`}>
            <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="个人数据分类">{dataTabs.map(([value, label, count]) => <Button key={value} id={`account-tab-${value}`} role="tab" aria-selected={dataTab === value} aria-controls={`account-panel-${value}`} size="sm" variant={dataTab === value ? "default" : "ghost"} className="shrink-0 rounded-full" onClick={() => setDataTab(value)}>{label}<span className="font-mono text-xs opacity-70">{count}</span></Button>)}</div>
            <motion.div id={`account-panel-${dataTab}`} role="tabpanel" aria-labelledby={`account-tab-${dataTab}`} key={dataTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }} className="mt-6">
              <div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold">{dataInfo[dataTab][0]}</h2><p className="mt-1 text-sm text-muted-foreground">{dataInfo[dataTab][1]}</p></div><div className="flex shrink-0 gap-1">{dataCompareHref && <Button asChild size="sm" variant="outline"><a href={dataCompareHref}>比较商品 {dataCompareIds.length}</a></Button>}{dataTab === "recent" && recentViews.length > 0 && <Button size="sm" variant="ghost" onClick={() => { clearRecentViews(); setRecentViews([]) }}>清空</Button>}</div></div>

              {dataTab === "logs" && <div className={listClass}>{logs.length ? logs.slice(0, 30).map((log) => <div key={log.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{log.products?.name || productNames.get(String(log.product_id)) || log.product_id}</p><p className="mt-1 truncate text-xs text-muted-foreground">{log.stores?.name || storeNames.get(String(log.store_id)) || "未指定门店"}，{formatDate(log.purchased_at || log.created_at)}{log.note ? `，${log.note}` : ""}</p></div><span className="shrink-0 font-mono font-semibold">{formatPrice(log.price_yen)}</span></div>) : <p className="py-12 text-center text-sm text-muted-foreground">还没有价格记录。</p>}</div>}
              {dataTab === "recent" && <div className={listClass}>{recentViews.length ? recentViews.map((item) => <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.brand || "品牌未登记"}，{item.pack || "规格未登记"}，{formatDate(item.viewed_at)}</p></div><Button asChild size="sm" variant="ghost"><a href={appPath(`/product/?id=${encodeURIComponent(item.id)}`)}>打开</a></Button></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无浏览记录。</p>}</div>}
              {dataTab === "favorites" && <div className={listClass}>{favorites.length ? favorites.map((item) => { const label = item.entity_type === "product" ? productNames.get(String(item.entity_id)) : storeNames.get(String(item.entity_id)); return <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{label || item.entity_id}</p><p className="mt-1 text-xs text-muted-foreground">{item.entity_type === "product" ? "商品" : "门店"}，{formatDate(item.created_at)}</p></div><div className="flex gap-1">{item.entity_type === "product" && <Button asChild size="sm" variant="ghost"><a href={appPath(`/product/?id=${encodeURIComponent(item.entity_id)}`)}>打开</a></Button>}<Button size="sm" variant="ghost" onClick={() => removeFavorite(item)}>移除</Button></div></div> }) : <p className="py-12 text-center text-sm text-muted-foreground">还没有收藏。</p>}</div>}
              {dataTab === "credits" && <><div className="mt-5 grid gap-3 sm:grid-cols-3">{[["今日商品检索", `${credit?.searches_today ?? 0}/${credit?.daily_free_searches ?? 0}`, `超出后 ${credit?.search_cost_after_free ?? 0} 分/次`], ["今日价格查询", `${credit?.references_today ?? 0}/${credit?.daily_free_price_references ?? 0}`, `超出后 ${credit?.price_reference_cost ?? 0} 分/次`], ["贡献奖励", `+${credit?.approved_contribution_reward ?? 0}`, "公共价格审核通过后发放"]].map(([label, value, note]) => <div key={label} className="rounded-xl bg-muted p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>)}</div><div className={listClass}>{ledger.length ? ledger.slice(0, 20).map((item) => <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{item.reason || "积分变动"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{formatDate(item.created_at)}{item.note ? `，${item.note}` : ""}</p></div><span className={`shrink-0 font-mono font-semibold ${Number(item.amount) > 0 ? "text-primary" : ""}`}>{Number(item.amount) > 0 ? "+" : ""}{item.amount}</span></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无积分流水。</p>}</div></>}
              {dataTab === "submissions" && <div className={listClass}>{submissions.length ? submissions.map((item) => <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">JAN {item.barcode}，{formatDate(item.created_at)}</p></div><Badge variant={item.review_status === "approved" ? "default" : "outline"}>{reviewLabels[item.review_status] || "状态未知"}</Badge></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无商品补录记录。</p>}</div>}
            </motion.div>
          </section>
        </div>
      </section>
    </AppShell>
  )
}
