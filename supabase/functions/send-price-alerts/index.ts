const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const serviceKey = () => {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (legacy) return legacy
  const keys = JSON.parse(requiredEnv("SUPABASE_SECRET_KEYS"))
  if (!keys.default) throw new Error("SUPABASE_SECRET_KEYS.default is not configured")
  return keys.default
}

const rpc = async (name: string, body: unknown) => {
  const key = serviceKey()
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${name} failed: ${await response.text()}`)
  return response.json()
}

const siteUrl = (path: string) => {
  const base = requiredEnv("PRICE_ALERT_APP_URL").replace(/\/?$/, "/")
  return new URL(path.replace(/^\//, ""), base)
}

const productUrl = (productId: string) => {
  const url = siteUrl("product/")
  url.searchParams.set("id", productId)
  return url.toString()
}

const sendEmail = async (delivery: Record<string, unknown>) => {
  const price = Number(delivery.price_yen).toLocaleString("ja-JP")
  const target = Number(delivery.target_price_yen).toLocaleString("ja-JP")
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "content-type": "application/json",
      "idempotency-key": String(delivery.idempotency_key),
      "user-agent": "aaprice-price-alerts/1.0",
    },
    body: JSON.stringify({
      from: requiredEnv("PRICE_ALERT_FROM_EMAIL"),
      to: [delivery.email],
      subject: `AAPRICE 降价提醒：${delivery.product_name}`,
      text: `${delivery.product_name} 当前最低价为 ¥${price}，已达到你设置的 ¥${target} 目标价。\n\n查看商品：${productUrl(String(delivery.product_id))}\n管理或停用提醒：${siteUrl("me/")}\n\n价格可能发生变化，请以商家结算页面为准。`,
      tags: [{ name: "type", value: "price_alert" }],
    }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.id) throw new Error(result.message || `Resend returned ${response.status}`)
  return result.id as string
}

export default {
  async fetch(request: Request) {
    const expected = requiredEnv("PRICE_ALERT_CRON_SECRET")
    if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${expected}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
      const deliveries = await rpc("claim_price_alert_deliveries", { payload: { limit: 25 } })
      let sent = 0
      let failed = 0

      for (const delivery of deliveries) {
        try {
          const messageId = await sendEmail(delivery)
          await rpc("complete_price_alert_delivery", { payload: { delivery_id: delivery.id, succeeded: true, provider_message_id: messageId } })
          sent += 1
        } catch (error) {
          await rpc("complete_price_alert_delivery", { payload: { delivery_id: delivery.id, succeeded: false, error_message: String(error) } })
          failed += 1
        }
      }

      return Response.json({ claimed: deliveries.length, sent, failed })
    } catch (error) {
      console.error(error)
      return Response.json({ error: "Price alert run failed" }, { status: 500 })
    }
  },
}
