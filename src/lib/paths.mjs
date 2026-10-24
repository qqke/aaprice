export const appPath = (path = "/", base = import.meta.env?.BASE_URL || "/") =>
  `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}` || "/"

export function safeReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) return ""
  try {
    const url = new URL(value, "https://lowprice.invalid")
    return url.origin === "https://lowprice.invalid" ? url.pathname + url.search + url.hash : ""
  } catch { return "" }
}

export function authRedirectUrl(origin, returnPath = "", mode = "") {
  const url = new URL(appPath("/login/"), origin)
  if (mode) url.searchParams.set("mode", mode)
  const destination = safeReturnPath(returnPath)
  if (destination) url.searchParams.set("redirect", destination)
  return url.href
}
