export const CATALOG_STATE_KEY = "aprice:catalog-return"

// Tab-local, short-lived view state. Never use this cache for paid price queries.
export function readCatalogState(raw, now = Date.now()) {
  try {
    const value = JSON.parse(raw)
    if (!value || !Number.isFinite(value.savedAt) || now - value.savedAt > 15 * 60 * 1000 || value.savedAt > now) return null
    if (!Array.isArray(value.catalog) || value.catalog.length > 300) return null
    if (!value.catalog.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.offers) && Array.isArray(item.tags))) return null
    return {
      catalog: value.catalog,
      userId: typeof value.userId === "string" ? value.userId : null,
      location: Number.isFinite(value.location?.lat) && Math.abs(value.location.lat) <= 90 && Number.isFinite(value.location?.lng) && Math.abs(value.location.lng) <= 180 ? value.location : null,
      query: typeof value.query === "string" ? value.query.slice(0, 300) : "",
      segment: typeof value.segment === "string" ? value.segment : "全部",
      budget: Number.isFinite(value.budget) ? value.budget : 10000,
      sort: ["score", "price", "unit", "saving", "distance"].includes(value.sort) ? value.sort : "score",
      filtersOpen: value.filtersOpen === true,
      hasMore: value.hasMore === true,
      scrollY: Number.isFinite(value.scrollY) ? Math.max(0, value.scrollY) : 0,
    }
  } catch { return null }
}
