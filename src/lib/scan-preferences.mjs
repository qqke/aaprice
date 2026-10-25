const PRICE_FIRST_KEY = "aprice:scan-price-first"
let sessionPreference = false

export function readScanPriceFirst() {
  try { return globalThis.localStorage ? globalThis.localStorage.getItem(PRICE_FIRST_KEY) === "1" : sessionPreference } catch { return sessionPreference }
}

export function saveScanPriceFirst(enabled) {
  sessionPreference = Boolean(enabled)
  try { globalThis.localStorage?.setItem(PRICE_FIRST_KEY, enabled ? "1" : "0") } catch {}
}
