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

test("active price tasks are restored only for the current user", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260824161000_active_price_task.sql", import.meta.url), "utf8")
  assert.match(sql, /create or replace function public\.get_active_price_task\(\)/)
  assert.match(sql, /task\.assigned_user_id = auth\.uid\(\)/)
  assert.match(sql, /task\.completed_at is null/)
  assert.match(sql, /task\.skipped_at is null/)
  assert.match(sql, /task\.expires_at > now\(\)/)
  assert.match(sql, /revoke all on function public\.get_active_price_task\(\) from public/)
  assert.match(sql, /grant execute on function public\.get_active_price_task\(\) to authenticated/)
  assert.doesNotMatch(sql, /grant execute[\s\S]* to anon/)
})

test("security audit stays read-only and covers critical boundaries", async () => {
  const sql = await readFile(new URL("../supabase/checks/security_audit.sql", import.meta.url), "utf8")
  assert.match(sql, /tables_without_rls/)
  assert.match(sql, /rls_tables_without_policies_review/)
  assert.match(sql, /definer_functions_without_safe_search_path/)
  assert.match(sql, /definer_functions_executable_by_public/)
  assert.match(sql, /client_table_access_review/)
  assert.doesNotMatch(sql, /\b(create|alter|drop|insert|update|delete|grant|revoke|truncate)\b/i)
})

test("price health summary is admin-only and measures fresh coverage", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260831100000_price_health_summary.sql", import.meta.url), "utf8")
  assert.match(sql, /create or replace function public\.admin_fetch_price_health\(payload jsonb default '\{\}'::jsonb\)/)
  assert.match(sql, /perform public\.require_admin_user\(\)/)
  assert.match(sql, /distinct on \(price\.product_id, price\.store_id\)/)
  assert.match(sql, /fresh_coverage_percent/)
  assert.match(sql, /stale_store_price_percent/)
  assert.match(sql, /products_needing_prices/)
  assert.match(sql, /set search_path = public, pg_temp/)
  assert.match(sql, /revoke all on function public\.admin_fetch_price_health\(jsonb\) from public/)
  assert.match(sql, /grant execute on function public\.admin_fetch_price_health\(jsonb\) to authenticated/)
  assert.doesNotMatch(sql, /grant execute[\s\S]* to anon/)
})
