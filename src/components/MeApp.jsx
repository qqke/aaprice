import { motion } from "motion/react"
import { KeyRound, ListChecks, LogOut, Save, SkipForward, Sparkles } from "lucide-react"
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
  fetchFavorites,
  fetchMyProductSubmissions,
  fetchPersonalLogs,
  fetchRecentViews,
  friendlyApiError,
  getSession,
  savePersonalLog,
  searchProducts,
  searchStores,
  signOut,
  skipPriceTask,
  toggleFavorite,
} from "@/lib/aprice-api.mjs"
import { formatPrice } from "@/lib/products.mjs"

const formatDate = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "未知"
const panelClass = "rounded-3xl border bg-card p-5 shadow-[0_18px_50px_oklch(0.18_0.03_178_/_0.055)] sm:p-6"
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
  const [logForm, setLogForm] = useState({ product_id: "", store_id: "", price_yen: "", note: "" })
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" })

  const load = async () => {
    setLoading(true)
    setRecentViews(fetchRecentViews())
    try {
      const activeSession = await getSession()
      setSession(activeSession)
      if (!activeSession) return
      const [nextProfile, productRows, storeRows, logRows, favoriteRows, summary, creditRows, submissionRows] = await Promise.all([
        fetchCurrentProfile(), searchProducts("", 500, { curated: false }), searchStores("", 500), fetchPersonalLogs(activeSession.user.id), fetchFavorites(activeSession.user.id), fetchCreditSummary(), fetchCreditLedger(30), fetchMyProductSubmissions(activeSession.user.id),
      ])
      setProfile(nextProfile)
      setProducts(productRows)
      setStores(storeRows)
      setLogs(logRows)
      setFavorites(favoriteRows)
      setCredit(summary)
      setLedger(creditRows)
      setSubmissions(submissionRows)
    } catch (error) { setStatus(friendlyApiError(error)) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const productNames = useMemo(() => new Map(products.map((item) => [String(item.id), item.name])), [products])
  const storeNames = useMemo(() => new Map(stores.map((item) => [String(item.id), item.name])), [stores])

  const saveLog = async (event) => {
    event.preventDefault()
    try {
      await savePersonalLog({ ...logForm, price_yen: Number(logForm.price_yen), store_id: logForm.store_id || null, purchased_at: new Date().toISOString().slice(0, 10) })
      setLogForm({ product_id: "", store_id: "", price_yen: "", note: "" })
      setLogs(await fetchPersonalLogs(session.user.id))
      setStatus("价格记录已保存。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const removeFavorite = async (item) => {
    try {
      await toggleFavorite(item.entity_type, item.entity_id)
      setFavorites((rows) => rows.filter((row) => row.id !== item.id))
      setStatus("收藏已移除。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const claimTask = async () => {
    try { setTask(await claimRandomPriceTask()); setStatus("已领取补价任务。") } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const skipTask = async () => {
    try { await skipPriceTask(task.id); setTask(null); setStatus("已跳过当前任务。") } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const updateAccountPassword = async (event) => {
    event.preventDefault()
    if (passwordForm.next.length < 8 || passwordForm.next !== passwordForm.confirm) { setStatus("新密码至少 8 位，且两次输入必须一致。"); return }
    try {
      await changePassword(passwordForm.current, passwordForm.next)
      setPasswordForm({ current: "", next: "", confirm: "" })
      setStatus("密码已更新。")
    } catch (error) { setStatus(friendlyApiError(error)) }
  }

  const logout = async () => { await signOut(); window.location.assign("/") }

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

  if (loading) return <AppShell title="个人中心"><AppLoading label="正在同步账户" /></AppShell>
  if (!session) return <AppShell eyebrow="个人中心" title="登录后管理自己的价格。" description="收藏、记录、额度和任务会同步到你的 AAPRICE 账号。"><div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6 lg:px-8"><Button asChild><a href="/login/?redirect=/me/">登录或注册</a></Button></div></AppShell>

  return (
    <AppShell eyebrow="个人中心" title={profile?.full_name || "我的账户"} description={`已登录 ${session.user.email}`} session={session} profile={profile} actions={<Button variant="outline" onClick={logout}><LogOut /> 退出登录</Button>}>
      <section className="mx-auto max-w-[1320px] px-4 pb-24 sm:px-6 lg:px-8">
        {status && <div className="mb-6 rounded-2xl border bg-card px-4 py-3 text-sm shadow-sm" role="status">{status}</div>}

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-[0_24px_70px_oklch(0.43_0.09_178_/_0.2)] sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-primary-foreground/70">账户概览</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">你的价格工作台</h2></div><Badge className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground">{profile?.role === "admin" ? "管理员" : "普通用户"}</Badge></div>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">{[["积分余额", credit?.balance ?? 0], ["价格记录", logs.length], ["收藏", favorites.length]].map(([label, value]) => <div key={label} className="border-t border-primary-foreground/20 pt-4"><p className="text-sm text-primary-foreground/70">{label}</p><p className="mt-2 font-mono text-3xl font-semibold">{value}</p></div>)}</div>
        </motion.div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)] lg:items-start">
          <div className="min-w-0 space-y-5 lg:sticky lg:top-24">
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className={panelClass}>
              <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">快速记录价格</h2><p className="mt-1 text-sm text-muted-foreground">个人记录不会公开。</p></div><Save className="size-5 text-primary" /></div>
              <form onSubmit={saveLog} className="mt-6 space-y-4">
                <label><span className="mb-2 block text-sm font-medium">商品</span><select value={logForm.product_id} onChange={(event) => setLogForm({ ...logForm, product_id: event.target.value })} className="h-10 w-full rounded-xl border bg-background px-3 text-sm" required><option value="">选择商品</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span className="mb-2 block text-sm font-medium">门店</span><select value={logForm.store_id} onChange={(event) => setLogForm({ ...logForm, store_id: event.target.value })} className="h-10 w-full rounded-xl border bg-background px-3 text-sm"><option value="">不指定门店</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span className="mb-2 block text-sm font-medium">价格（日元）</span><Input type="number" min="1" value={logForm.price_yen} onChange={(event) => setLogForm({ ...logForm, price_yen: event.target.value })} required /></label>
                <label><span className="mb-2 block text-sm font-medium">备注</span><Input value={logForm.note} onChange={(event) => setLogForm({ ...logForm, note: event.target.value })} placeholder="促销、会员价等" /></label>
                <Button type="submit" className="w-full"><Save /> 保存记录</Button>
              </form>
            </motion.section>

            <section className={panelClass}>
              <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">随机补价任务</h2><p className="mt-1 text-sm text-muted-foreground">提交一致价格可获得积分。</p></div><ListChecks className="size-5 text-primary" /></div>
              {task ? <div className="mt-5 rounded-2xl bg-muted p-4"><p className="font-medium">{productNames.get(String(task.product_id)) || task.product_id}</p><p className="mt-1 text-sm text-muted-foreground">{storeNames.get(String(task.store_id)) || task.store_id || "任意门店"}</p><div className="mt-4 flex gap-2"><Button asChild size="sm"><a href={`/product/?id=${encodeURIComponent(task.product_id)}`}>去补价</a></Button><Button size="sm" variant="outline" onClick={skipTask}><SkipForward /> 跳过</Button></div></div> : <Button className="mt-5" variant="outline" onClick={claimTask}><Sparkles /> 领取随机任务</Button>}
            </section>

            <section className={panelClass}>
              <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">修改密码</h2><p className="mt-1 text-sm text-muted-foreground">验证当前密码后更新。</p></div><KeyRound className="size-5 text-primary" /></div>
              <form onSubmit={updateAccountPassword} className="mt-5 space-y-3">{[["当前密码", "current"], ["新密码", "next"], ["确认新密码", "confirm"]].map(([label, key]) => <label key={key}><span className="mb-2 block text-sm font-medium">{label}</span><Input type="password" value={passwordForm[key]} onChange={(event) => setPasswordForm({ ...passwordForm, [key]: event.target.value })} required /></label>)}<Button type="submit" variant="outline" className="w-full">更新密码</Button></form>
            </section>
          </div>

          <section className={`${panelClass} min-w-0`}>
            <div className="flex gap-2 overflow-x-auto pb-2" aria-label="个人数据分类">{dataTabs.map(([value, label, count]) => <Button key={value} size="sm" variant={dataTab === value ? "default" : "ghost"} className="shrink-0 rounded-full" onClick={() => setDataTab(value)}>{label}<span className="font-mono text-xs opacity-70">{count}</span></Button>)}</div>
            <motion.div key={dataTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }} className="mt-6">
              <div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold">{dataInfo[dataTab][0]}</h2><p className="mt-1 text-sm text-muted-foreground">{dataInfo[dataTab][1]}</p></div>{dataTab === "recent" && recentViews.length > 0 && <Button size="sm" variant="ghost" onClick={() => { clearRecentViews(); setRecentViews([]) }}>清空</Button>}</div>

              {dataTab === "logs" && <div className={listClass}>{logs.length ? logs.slice(0, 30).map((log) => <div key={log.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{log.products?.name || productNames.get(String(log.product_id)) || log.product_id}</p><p className="mt-1 truncate text-xs text-muted-foreground">{log.stores?.name || storeNames.get(String(log.store_id)) || "未指定门店"}，{formatDate(log.purchased_at || log.created_at)}{log.note ? `，${log.note}` : ""}</p></div><span className="shrink-0 font-mono font-semibold">{formatPrice(log.price_yen)}</span></div>) : <p className="py-12 text-center text-sm text-muted-foreground">还没有价格记录。</p>}</div>}
              {dataTab === "recent" && <div className={listClass}>{recentViews.length ? recentViews.map((item) => <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.brand || "品牌未登记"}，{item.pack || "规格未登记"}，{formatDate(item.viewed_at)}</p></div><Button asChild size="sm" variant="ghost"><a href={`/product/?id=${encodeURIComponent(item.id)}`}>打开</a></Button></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无浏览记录。</p>}</div>}
              {dataTab === "favorites" && <div className={listClass}>{favorites.length ? favorites.map((item) => { const label = item.entity_type === "product" ? productNames.get(String(item.entity_id)) : storeNames.get(String(item.entity_id)); return <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{label || item.entity_id}</p><p className="mt-1 text-xs text-muted-foreground">{item.entity_type === "product" ? "商品" : "门店"}，{formatDate(item.created_at)}</p></div><div className="flex gap-1">{item.entity_type === "product" && <Button asChild size="sm" variant="ghost"><a href={`/product/?id=${encodeURIComponent(item.entity_id)}`}>打开</a></Button>}<Button size="sm" variant="ghost" onClick={() => removeFavorite(item)}>移除</Button></div></div> }) : <p className="py-12 text-center text-sm text-muted-foreground">还没有收藏。</p>}</div>}
              {dataTab === "credits" && <div className={listClass}>{ledger.length ? ledger.slice(0, 20).map((item) => <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{item.reason || "积分变动"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{formatDate(item.created_at)}{item.note ? `，${item.note}` : ""}</p></div><span className={`shrink-0 font-mono font-semibold ${Number(item.amount) > 0 ? "text-primary" : ""}`}>{Number(item.amount) > 0 ? "+" : ""}{item.amount}</span></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无积分流水。</p>}</div>}
              {dataTab === "submissions" && <div className={listClass}>{submissions.length ? submissions.map((item) => <div key={item.id} className={rowClass}><div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">JAN {item.barcode}，{formatDate(item.created_at)}</p></div><Badge variant={item.review_status === "approved" ? "default" : "outline"}>{item.review_status}</Badge></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无商品补录记录。</p>}</div>}
            </motion.div>
          </section>
        </div>
      </section>
    </AppShell>
  )
}
