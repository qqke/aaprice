const runtimeConfig = globalThis.__APriceConfig || {}
const SUPABASE_URL = String(import.meta.env?.PUBLIC_SUPABASE_URL || runtimeConfig.supabaseUrl || "").trim()
const SUPABASE_ANON_KEY = String(import.meta.env?.PUBLIC_SUPABASE_ANON_KEY || runtimeConfig.supabaseAnonKey || "").trim()
export const turnstileSiteKey = String(import.meta.env?.PUBLIC_TURNSTILE_SITE_KEY || runtimeConfig.turnstileSiteKey || "").trim()
export const turnstileEnabled = Boolean(turnstileSiteKey && String(import.meta.env?.PUBLIC_DISABLE_TURNSTILE || "0") !== "1")

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

let clientPromise

function ensureConfigured() {
  if (!supabaseConfigured) throw new Error("尚未配置 Supabase 环境变量")
}

async function getClient() {
  ensureConfigured()
  clientPromise ||= import("@supabase/supabase-js").then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }))
  return clientPromise
}

function buildUrl(path, query = {}) {
  ensureConfigured()
  const url = new URL(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
  return url
}

async function request(path, { method = "GET", query, body, token, prefer } = {}) {
  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text || `Supabase request failed with ${response.status}`
    try {
      const parsed = JSON.parse(text)
      message = parsed.message || parsed.error_description || parsed.details || message
    } catch {}
    throw new Error(message)
  }
  return text ? JSON.parse(text) : null
}

const rpc = (name, body = {}, token = "") => request(`rpc/${name}`, { method: "POST", body, token, prefer: "return=representation" })
const insert = (table, body, token = "") => request(table, { method: "POST", body, token, prefer: "return=representation" })
const TELEMETRY_SESSION_KEY = "aprice:telemetry-session"

function getTelemetrySessionId() {
  if (typeof window === "undefined") return ""
  let sessionId
  try { sessionId = sessionStorage.getItem(TELEMETRY_SESSION_KEY) } catch {}
  sessionId ||= crypto.randomUUID()
  try { sessionStorage.setItem(TELEMETRY_SESSION_KEY, sessionId) } catch {}
  return sessionId
}

async function requireSession() {
  const session = await getSession()
  if (!session?.user) throw new Error("请先登录后再操作")
  return session
}

const escapeIlike = (value) => String(value || "")
  .replace(/\\/g, "\\\\")
  .replace(/%/g, "\\%")
  .replace(/_/g, "\\_")
  .replace(/'/g, "''")

export async function searchProducts(term = "", limit = 30, { offset = 0, curated = true } = {}) {
  const query = {
    select: "*",
    order: "last_seen_at.desc.nullslast,updated_at.desc",
    limit: Math.max(1, Math.min(Number(limit) || 30, 500)),
    offset: Math.max(0, Number(offset) || 0),
  }
  const value = String(term || "").trim()
  if (value) {
    const pattern = `%${escapeIlike(value)}%`
    const barcode = value.replace(/\D/g, "")
    const filters = [`name.ilike.${pattern}`, `brand.ilike.${pattern}`, `category.ilike.${pattern}`]
    if (barcode) filters.push(`barcode.ilike.%${barcode}%`)
    query.or = `(${filters.join(",")})`
  } else if (curated) {
    // ponytail: keyword curation keeps the storefront on-topic until products have a dedicated catalog flag.
    query.or = `(${["医薬", "薬用", "化粧", "コスメ", "スキン", "美容", "サプリ", "ビタミン", "目薬", "日焼け", "シャンプー"]
      .flatMap((keyword) => [`name.ilike.%${keyword}%`, `category.ilike.%${keyword}%`])
      .join(",")})`
  }
  return request("products", { query })
}

export async function fetchProductByBarcode(value) {
  const barcode = String(value || "").replace(/\D/g, "")
  if (!barcode) return null
  const rows = await request("products", {
    query: { select: "*", barcode: `eq.${barcode}`, limit: 1 },
  })
  return rows?.[0] || null
}

export async function fetchProductById(id) {
  if (!id) return null
  const rows = await request("products", { query: { select: "*", id: `eq.${id}`, limit: 1 } })
  return rows?.[0] || null
}

export async function searchStores(term = "", limit = 100) {
  const query = { select: "*", order: "name.asc", limit: Math.max(1, Math.min(Number(limit) || 100, 500)) }
  const value = String(term || "").trim()
  if (value) {
    const pattern = `%${escapeIlike(value)}%`
    query.or = `(${[`name.ilike.${pattern}`, `chain_name.ilike.${pattern}`, `pref.ilike.${pattern}`, `city.ilike.${pattern}`, `address.ilike.${pattern}`].join(",")})`
  }
  return request("stores", { query })
}

export async function fetchPricesForProduct(productId, { token, lat, lng, limit = 120 } = {}) {
  if (!token) throw new Error("请先登录后再查询门店价格")
  const rows = await request("rpc/fetch_product_prices", {
    method: "POST",
    token,
    body: {
      payload: {
        product_id: productId,
        limit,
        ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
      },
    },
  })
  return Array.isArray(rows) ? rows : []
}

export async function fetchPublicPricePreview(productId) {
  if (!productId) return null
  const rows = await rpc("fetch_public_product_price_preview", { payload: { product_id: productId } })
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row || !Number.isFinite(Number(row.min_price_yen))) return null
  return {
    minPrice: Number(row.min_price_yen),
    storeCount: Number(row.store_count) || 0,
    latestCollectedAt: row.latest_collected_at || null,
  }
}

export async function recordTelemetryEvent(eventName, properties = {}) {
  if (!supabaseConfigured || typeof window === "undefined") return
  const session = await getSession().catch(() => null)
  await rpc("record_telemetry_event", { payload: { event_name: eventName, session_id: getTelemetrySessionId(), properties } }, session?.access_token)
}

export async function fetchCommercialOffers(productIds = []) {
  if (!supabaseConfigured) return []
  const result = await rpc("fetch_commercial_offers", { payload: { product_ids: productIds.map(String).filter(Boolean).slice(0, 100) } })
  return Array.isArray(result) ? result : []
}

export async function recordCommercialClick(offerId, source) {
  if (!offerId || !["product", "compare"].includes(source)) throw new Error("商业链接参数无效")
  const session = await getSession().catch(() => null)
  const url = await rpc("record_commercial_click", { payload: { offer_id: offerId, session_id: getTelemetrySessionId(), source } }, session?.access_token)
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("商业链接暂不可用")
  void recordTelemetryEvent("commercial_outbound_clicked", { offer_id: offerId, source }).catch(() => {})
  return url
}

export async function getSession() {
  if (!supabaseConfigured) return null
  const supabase = await getClient()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session || null
}

export async function signInWithEmailPassword(email, password, captchaToken = "") {
  const supabase = await getClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: captchaToken || undefined },
  })
  if (error) throw error
  return data.session
}

export async function signUpWithEmailPassword(email, password, captchaToken = "") {
  const supabase = await getClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken: captchaToken || undefined,
      emailRedirectTo: typeof window === "undefined" ? undefined : `${window.location.origin}/login/`,
    },
  })
  if (error) throw error
  if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) throw new Error("该邮箱已经注册")
  return data
}

export async function sendPasswordResetEmail(email, captchaToken = "") {
  const supabase = await getClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    captchaToken: captchaToken || undefined,
    redirectTo: typeof window === "undefined" ? undefined : `${window.location.origin}/login/?mode=reset`,
  })
  if (error) throw error
}

export async function updatePassword(password) {
  const supabase = await getClient()
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  return data
}

export async function changePassword(currentPassword, password) {
  const supabase = await getClient()
  const { data, error } = await supabase.auth.updateUser({ current_password: currentPassword, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const supabase = await getClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function subscribeAuthState(callback) {
  if (!supabaseConfigured) return () => {}
  const supabase = await getClient()
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}

export async function fetchCurrentProfile() {
  const session = await requireSession()
  const rows = await request("profiles", {
    token: session.access_token,
    query: { select: "id,email,full_name,role,created_at,updated_at", id: `eq.${session.user.id}`, limit: 1 },
  })
  return rows?.[0] || { id: session.user.id, email: session.user.email, role: "user" }
}

export async function fetchPersonalLogs(userId) {
  const session = await requireSession()
  return request("user_price_logs", {
    token: session.access_token,
    query: { select: "*,products:product_id(*),stores:store_id(*)", user_id: `eq.${userId || session.user.id}`, order: "created_at.desc", limit: 200 },
  })
}

export async function savePersonalLog(entry) {
  const session = await requireSession()
  const price = Number(entry?.price_yen)
  if (!entry?.product_id || !Number.isInteger(price) || price <= 0) throw new Error("请选择商品并输入有效的日元价格")
  return insert("user_price_logs", { ...entry, price_yen: price, user_id: session.user.id }, session.access_token)
}

export async function submitStorePrice(entry) {
  const session = await requireSession()
  const price = Number(entry?.price_yen)
  if (!entry?.product_id || !entry?.store_id || !Number.isInteger(price) || price <= 0) throw new Error("请选择商品和门店并输入有效价格")
  return rpc("submit_store_price", { payload: { ...entry, price_yen: price } }, session.access_token)
}

export async function fetchFavorites(userId) {
  const session = await requireSession()
  return request("favorites", {
    token: session.access_token,
    query: { select: "*", user_id: `eq.${userId || session.user.id}`, order: "created_at.desc", limit: 200 },
  })
}

export async function fetchFavoritePriceChanges(payload = {}) {
  const session = await requireSession()
  const result = await rpc("fetch_favorite_price_changes", { payload }, session.access_token)
  const summary = Array.isArray(result) ? result[0] : result
  return { days: Number(summary?.days) || 7, items: Array.isArray(summary?.items) ? summary.items : [] }
}

export async function fetchMyPriceAlerts() {
  const session = await requireSession()
  const result = await rpc("fetch_my_price_alerts", {}, session.access_token)
  return Array.isArray(result) ? result : []
}

export async function upsertPriceAlert(payload) {
  const session = await requireSession()
  return rpc("upsert_price_alert", { payload }, session.access_token)
}

export async function toggleFavorite(entityType, entityId) {
  const session = await requireSession()
  const existing = await request("favorites", {
    token: session.access_token,
    query: { select: "id", user_id: `eq.${session.user.id}`, entity_type: `eq.${entityType}`, entity_id: `eq.${entityId}`, limit: 1 },
  })
  if (existing?.[0]?.id) {
    await request("favorites", { method: "DELETE", token: session.access_token, query: { id: `eq.${existing[0].id}` }, prefer: "return=representation" })
    return { action: "removed" }
  }
  await insert("favorites", { user_id: session.user.id, entity_type: entityType, entity_id: entityId }, session.access_token)
  return { action: "added" }
}

export async function fetchCreditSummary() {
  const session = await requireSession()
  const result = await rpc("fetch_credit_summary", {}, session.access_token)
  return Array.isArray(result) ? result[0] || {} : result || {}
}

export async function fetchCreditLedger(limit = 30) {
  const session = await requireSession()
  return request("credit_ledger", {
    token: session.access_token,
    query: { select: "*", user_id: `eq.${session.user.id}`, order: "created_at.desc", limit: Math.max(1, Math.min(Number(limit) || 30, 100)) },
  })
}

export async function recordProductSearch(value) {
  const session = await requireSession()
  return rpc("record_product_search", { payload: { query: String(value || "") } }, session.access_token)
}

export async function claimRandomPriceTask() {
  const session = await requireSession()
  const result = await rpc("claim_random_price_task", {}, session.access_token)
  return Array.isArray(result) ? result[0] || null : result || null
}

export async function fetchActivePriceTask() {
  const session = await requireSession()
  try {
    const result = await rpc("get_active_price_task", {}, session.access_token)
    return Array.isArray(result) ? result[0] || null : result || null
  } catch (error) {
    if (/get_active_price_task|PGRST202|schema cache/i.test(String(error?.message || error))) return null
    throw error
  }
}

export async function skipPriceTask(id) {
  const session = await requireSession()
  return rpc("skip_price_task", { payload: { id } }, session.access_token)
}

export async function fetchMyProductSubmissions(userId, limit = 30) {
  const session = await requireSession()
  try {
    return await request("product_submissions", {
      token: session.access_token,
      query: { select: "*", user_id: `eq.${userId || session.user.id}`, order: "created_at.desc", limit },
    })
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function submitProductSubmission(payload) {
  const session = await requireSession()
  const barcode = String(payload?.barcode || "").replace(/\D/g, "")
  if (!/^\d{8}$|^\d{12,14}$/.test(barcode) || !String(payload?.name || "").trim()) throw new Error("请填写有效 JAN 码和商品名称")
  const imageUrl = String(payload?.image_url || "").trim()
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) throw new Error("图片地址必须是 HTTP(S) URL")
  const normalized = { ...payload, id: payload.id || barcode, barcode, image_url: imageUrl }
  try {
    return await rpc("submit_product_submission", { payload: normalized }, session.access_token)
  } catch (error) {
    const message = String(error?.message || "")
    if (!/submit_product_submission/i.test(message) || !/schema cache/i.test(message)) throw error
    return insert("product_submissions", {
      user_id: session.user.id,
      barcode,
      name: String(normalized.name).trim(),
      brand: normalized.brand || "",
      pack: normalized.pack || "",
      category: normalized.category || "",
      tone: normalized.tone || "sunset",
      description: normalized.description || "",
      image_url: imageUrl,
    }, session.access_token)
  }
}

export function parseJancodeProductDraft(markdown, value) {
  const barcode = String(value || "").replace(/\D/g, "")
  if (!barcode || /Target URL returned error|アクセスしようとしたページは表示できませんでした/i.test(markdown)) return null
  const clean = (text = "") => String(text).replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
  const tableValue = (label) => clean(markdown.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|$`, "m"))?.[1] || "")
  const name = clean(markdown.match(/^##\s*(.+)$/m)?.[1] || tableValue("商品名"))
  if (!name) return null
  return { id: barcode, barcode, name, brand: tableValue("会社名"), pack: "", category: tableValue("商品ジャンル").replace(/\s*>\s*/g, " > "), tone: "sunset", description: "", image_url: "" }
}

export async function fetchJancodeProductDraft(value) {
  const barcode = String(value || "").replace(/\D/g, "")
  if (!barcode) return null
  const response = await fetch(`https://r.jina.ai/http://www.jancode.xyz/${barcode}/`, { headers: { Accept: "text/plain" } })
  if (!response.ok) return null
  return parseJancodeProductDraft(await response.text(), barcode)
}

export async function fetchAppSettings() {
  const result = await rpc("fetch_app_settings")
  return Array.isArray(result) ? result[0] || {} : result || {}
}

export async function fetchPendingPriceSubmissions(limit = 50) {
  const session = await requireSession()
  return request("user_price_logs", {
    token: session.access_token,
    query: { select: "*,products:product_id(*),stores:store_id(*)", share_to_public: "eq.true", review_status: "eq.pending", order: "created_at.desc", limit },
  })
}

export async function fetchProductSubmissions(limit = 50) {
  const session = await requireSession()
  try {
    return await request("product_submissions", { token: session.access_token, query: { select: "*", review_status: "eq.pending", order: "created_at.desc", limit } })
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function fetchRecentPrices(limit = 50) {
  const session = await requireSession()
  return request("prices", {
    token: session.access_token,
    query: { select: "*,products:product_id(id,name,barcode),stores:store_id(id,name,chain_name)", order: "collected_at.desc", limit },
  })
}

export async function adminFetchProfiles(limit = 100) {
  const session = await requireSession()
  return request("profiles", { token: session.access_token, query: { select: "id,email,full_name,role,created_at", order: "created_at.desc", limit } })
}

export async function adminReviewPriceSubmission(id, action, note = "") {
  const session = await requireSession()
  return rpc("admin_review_price_submission", { payload: { id, action, review_note: note } }, session.access_token)
}

export async function adminReviewProductSubmission(id, action, note = "") {
  const session = await requireSession()
  return rpc("admin_review_product_submission", { payload: { id, action, review_note: note } }, session.access_token)
}

export async function adminUpsertProduct(payload) {
  const session = await requireSession()
  return rpc("admin_upsert_product", { payload }, session.access_token)
}

export async function adminUpsertStore(payload) {
  const session = await requireSession()
  return rpc("admin_upsert_store", { payload }, session.access_token)
}

export async function adminUpsertPrice(payload) {
  const session = await requireSession()
  return rpc("admin_upsert_price", { payload }, session.access_token)
}

export async function adminDeleteProduct(targetId) {
  const session = await requireSession()
  return rpc("admin_delete_product", { target_id: targetId }, session.access_token)
}

export async function adminDeleteStore(targetId) {
  const session = await requireSession()
  return rpc("admin_delete_store", { target_id: targetId }, session.access_token)
}

export async function adminDeletePrice(targetId) {
  const session = await requireSession()
  return rpc("admin_delete_price", { target_id: targetId }, session.access_token)
}

export async function adminAdjustCredits(payload) {
  const session = await requireSession()
  return rpc("admin_adjust_credits", { payload }, session.access_token)
}

export async function adminUpdateAppSetting(payload) {
  const session = await requireSession()
  return rpc("admin_update_app_setting", { payload }, session.access_token)
}

export async function adminFetchTelemetrySummary(payload = {}) {
  const session = await requireSession()
  const result = await rpc("admin_fetch_telemetry_summary", { payload }, session.access_token)
  return Array.isArray(result) ? result[0] || {} : result || {}
}

export async function adminFetchTelemetryRecent(payload = {}) {
  const session = await requireSession()
  const result = await rpc("admin_fetch_telemetry_recent", { payload }, session.access_token)
  const rows = Array.isArray(result) ? result[0] : result
  return Array.isArray(rows?.items) ? rows.items : []
}

export async function adminFetchPriceHealth(payload = {}) {
  const session = await requireSession()
  try {
    const result = await rpc("admin_fetch_price_health", { payload }, session.access_token)
    return Array.isArray(result) ? result[0] || {} : result || {}
  } catch (error) {
    if (/admin_fetch_price_health|PGRST202|schema cache/i.test(String(error?.message || error))) return {}
    throw error
  }
}

export async function adminFetchPriceAlertSummary(payload = {}) {
  const session = await requireSession()
  try {
    const result = await rpc("admin_fetch_price_alert_summary", { payload }, session.access_token)
    return Array.isArray(result) ? result[0] || {} : result || {}
  } catch (error) {
    if (/admin_fetch_price_alert_summary|PGRST202|schema cache/i.test(String(error?.message || error))) return {}
    throw error
  }
}

export async function adminFetchMembershipReadiness(payload = {}) {
  const session = await requireSession()
  try {
    const result = await rpc("admin_fetch_membership_readiness", { payload }, session.access_token)
    return Array.isArray(result) ? result[0] || {} : result || {}
  } catch (error) {
    if (/admin_fetch_membership_readiness|PGRST202|schema cache/i.test(String(error?.message || error))) return {}
    throw error
  }
}

export async function adminFetchCommercialOffers(payload = {}) {
  const session = await requireSession()
  const result = await rpc("admin_fetch_commercial_offers", { payload }, session.access_token)
  return Array.isArray(result) ? result : []
}

export async function adminUpsertCommercialOffer(payload) {
  const session = await requireSession()
  return rpc("admin_upsert_commercial_offer", { payload }, session.access_token)
}

export async function adminFetchAffiliateReports(payload = {}) {
  const session = await requireSession()
  try {
    const result = await rpc("admin_fetch_affiliate_reports", { payload }, session.access_token)
    return Array.isArray(result) ? result[0] || {} : result || {}
  } catch (error) {
    if (/admin_fetch_affiliate_reports|PGRST202|schema cache/i.test(String(error?.message || error))) return {}
    throw error
  }
}

export async function adminUpsertAffiliateReport(payload) {
  const session = await requireSession()
  return rpc("admin_upsert_affiliate_report", { payload }, session.access_token)
}

const RECENT_VIEWS_KEY = "aprice:recent-views"

export function fetchRecentViews() {
  if (typeof window === "undefined") return []
  try {
    const rows = JSON.parse(window.localStorage.getItem(RECENT_VIEWS_KEY) || "[]")
    return Array.isArray(rows) ? rows : []
  } catch { return [] }
}

export function recordRecentView(product) {
  if (!product?.id || typeof window === "undefined") return []
  const next = {
    id: String(product.id),
    name: String(product.name || ""),
    brand: String(product.brand || product.maker || ""),
    pack: String(product.pack || ""),
    barcode: String(product.barcode || ""),
    viewed_at: new Date().toISOString(),
  }
  const rows = [next, ...fetchRecentViews().filter((item) => String(item.id) !== next.id)].slice(0, 12)
  try { window.localStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(rows)) } catch {}
  return rows
}

export function clearRecentViews() {
  if (typeof window !== "undefined") try { window.localStorage.removeItem(RECENT_VIEWS_KEY) } catch {}
}

const productImages = {
  医薬品: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=82",
  化粧品: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=1200&q=82",
  default: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1200&q=82",
}

export function mapProductRow(row) {
  const pack = String(row?.pack || "规格未登记")
  const match = pack.match(/([\d.]+)\s*(錠|粒|包|枚|本|個|mL|ml|g|kg)/i)
  const unit = match?.[2]?.toLowerCase() === "ml" ? "mL" : match?.[2] || "件"
  const sourceCategory = String(row?.category || "").trim()
  const productText = `${row?.name || ""} ${sourceCategory}`
  const category = sourceCategory || (
    /医薬|目薬|点眼|錠|カプセル|軟膏|鎮痛|鼻炎|胃腸|かぜ|風邪/.test(productText) ? "医药品"
      : /化粧|コスメ|美容|乳液|化粧水|ファンデ|リップ|ネイル|日焼け/.test(productText) ? "护肤美妆"
        : /サプリ|ビタミン|健康食品/.test(productText) ? "营养保健"
          : /シャンプー|コンディショナー|ボディソープ|歯磨|ハミガキ/.test(productText) ? "日常护理"
            : "其他"
  )
  const imageKey = category.includes("医薬") || category.includes("药") ? "医薬品" : category.includes("化粧") || category.includes("护") ? "化粧品" : "default"
  return {
    id: String(row.id),
    barcode: String(row.barcode || ""),
    name: String(row.name || "未命名商品"),
    maker: String(row.brand || "品牌未登记"),
    category,
    pack,
    amount: Number(match?.[1]) || 1,
    unit,
    active: String(row.description || "商品说明未登记"),
    target: category,
    score: 0,
    tags: [],
    image: String(row.image_url || productImages[imageKey]),
    offers: [],
    sourceRow: row,
  }
}

export function offersFromPriceRows(rows = []) {
  const latestByStore = new Map()
  for (const row of rows.toSorted((a, b) => new Date(b.collected_at || 0) - new Date(a.collected_at || 0))) {
    const store = row.stores || {}
    const storeId = String(row.store_id || store.id || "")
    if (!storeId || latestByStore.has(storeId) || !Number.isFinite(Number(row.price_yen))) continue
    latestByStore.set(storeId, {
      id: storeId,
      name: String(store.name || "门店未登记"),
      chain: String(store.chain_name || ""),
      address: [store.pref, store.city, store.address].filter(Boolean).join(" "),
      lat: Number(store.lat),
      lng: Number(store.lng),
      price: Number(row.price_yen),
      member: Boolean(row.is_member_price),
      sampledAt: row.collected_at,
      distance: Number.isFinite(Number(row.distance_km)) ? Number(row.distance_km) : null,
    })
  }
  return [...latestByStore.values()]
}

export function friendlyApiError(error) {
  const message = String(error?.message || error || "")
  if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确。"
  if (/insufficient|credit|quota/i.test(message)) return "价格查询额度不足，请稍后再试。"
  if (/no_price_tasks_available/i.test(message)) return "当前没有可领取的补价任务。"
  if (/daily_task_claim_limit_reached/i.test(message)) return "今天领取任务的次数已达上限。"
  if (/failed to fetch|network/i.test(message)) return "网络连接失败，请检查后重试。"
  return message || "请求失败，请稍后再试。"
}

export const isMissingRelationError = (error) => /schema cache|relation .* does not exist|42P01/i.test(String(error?.message || error || ""))
