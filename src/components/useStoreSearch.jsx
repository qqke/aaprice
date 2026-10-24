import { useEffect, useState } from "react"
import { friendlyApiError, searchStores } from "@/lib/aprice-api.mjs"

export default function useStoreSearch(query, { enabled, location = null, physicalOnly = false }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState({ key: "", rows: [], busy: false, error: "" })
  const term = query.trim()
  const lat = location?.lat, lng = location?.lng
  const key = JSON.stringify([term, lat, lng, physicalOnly, attempt])
  useEffect(() => {
    if (!enabled) return
    let active = true
    setResult({ key, rows: [], busy: true, error: "" })
    const timer = setTimeout(async () => {
      try {
        const rows = await searchStores(term, 100, 0, { location: { lat, lng }, physicalOnly })
        if (active) setResult({ key, rows, busy: false, error: "" })
      } catch (error) {
        if (active) setResult({ key, rows: [], busy: false, error: friendlyApiError(error) })
      }
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [enabled, key])
  return {
    rows: enabled && result.key === key ? result.rows : [],
    busy: Boolean(enabled && (result.key !== key || result.busy)),
    error: enabled && result.key === key ? result.error : "",
    retry: () => setAttempt(value => value + 1),
  }
}
