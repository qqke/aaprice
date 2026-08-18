import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("public price preview exposes aggregates only", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260818174000_public_price_preview.sql", import.meta.url), "utf8")
  assert.match(sql, /returns table \(\s*min_price_yen integer,\s*store_count integer,\s*latest_collected_at timestamptz\s*\)/)
  assert.match(sql, /security definer/)
  assert.match(sql, /revoke all on function public\.fetch_public_product_price_preview\(jsonb\) from public/)
  assert.match(sql, /grant execute on function public\.fetch_public_product_price_preview\(jsonb\) to anon, authenticated/)
  assert.match(sql, /distinct on \(p\.store_id\)/)
  assert.match(sql, /\(product_id, store_id, collected_at desc\)/)
  assert.match(sql, /coalesce\(p\.is_member_price, false\) = false/)
})
