import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { friendlyApiError, searchProducts } from "@/lib/aprice-api.mjs"

export default function CommercialProductSearch({ onSelect }) {
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const pending = useRef(false)
  const search = async (event) => {
    event.preventDefault()
    if (pending.current) return
    const term = query.trim()
    setRows([])
    if (!term) { setMessage("请输入商品名、品牌或 JAN 码。"); return }
    pending.current = true
    setBusy(true)
    setMessage("正在搜索完整目录…")
    try {
      const results = await searchProducts(term, 50, { curated: false })
      setRows(results)
      setMessage(results.length === 50 ? "显示前 50 件，请补充关键词或输入完整 JAN 缩小范围。" : results.length ? `找到 ${results.length} 件商品，请核对 JAN 和规格后选择。` : "没有找到商品，请检查 JAN 或更换关键词。")
    } catch (error) { setMessage(`搜索失败：${friendlyApiError(error)}，请重试。`) }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="border-t pt-6 lg:col-span-2" aria-label="商业链接商品搜索">
    <h2 className="text-xl font-semibold">查找合作商品</h2>
    <p className="mt-2 text-sm text-muted-foreground">搜索完整目录，选择后带入下方商业链接表单，不会清空已填写的链接信息。</p>
    <form onSubmit={search} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1"><span className="mb-2 block text-sm font-medium">商品名、品牌或 JAN</span><Input type="search" value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setRows([]); setMessage("") }} placeholder="输入完整 JAN 可精确查找" /></label>
      <Button type="submit" disabled={busy}>{busy ? "搜索中…" : "搜索商品"}</Button>
    </form>
    <p className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">{message}</p>
    {rows.length > 0 && <ul className="mt-3 max-h-80 divide-y overflow-y-auto border-y">{rows.map((item) => <li key={item.id} className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0"><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{[item.brand, item.pack, `JAN ${item.barcode || "未登记"}`].filter(Boolean).join(" · ")}</p></div>
      <Button type="button" variant="outline" size="sm" onClick={() => { onSelect(item); setMessage(`已选择 ${item.name}，请在下方核对并保存商业链接。`) }}>选择<span className="sr-only"> {item.name}</span></Button>
    </li>)}</ul>}
  </section>
}
