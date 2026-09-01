const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
}

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
  return keys.default as string
}

const response = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
    if (request.method !== "POST") return response({ error: "Method not allowed" }, 405)

    const authorization = request.headers.get("authorization") || ""
    if (!authorization.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401)

    try {
      const body = await request.json().catch(() => ({}))
      if (body?.confirmation !== "DELETE") return response({ error: "Confirmation required" }, 400)

      const url = requiredEnv("SUPABASE_URL").replace(/\/$/, "")
      const key = serviceKey()
      const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization } })
      const user = await userResponse.json().catch(() => ({}))
      if (!userResponse.ok || !user?.id) return response({ error: "Unauthorized" }, 401)

      const adminHeaders: Record<string, string> = { apikey: key }
      if (key.startsWith("eyJ")) adminHeaders.authorization = `Bearer ${key}`
      const deleteResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers: adminHeaders })
      if (!deleteResponse.ok) throw new Error(await deleteResponse.text())

      return response({ deleted: true })
    } catch (error) {
      console.error(error)
      return response({ error: "Account deletion failed" }, 500)
    }
  },
}
