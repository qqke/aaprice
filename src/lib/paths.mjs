export const appPath = (path = "/", base = import.meta.env?.BASE_URL || "/") =>
  `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}` || "/"
