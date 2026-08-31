import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("business telemetry is allowlisted and strips direct identifiers", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260818183000_business_telemetry.sql", import.meta.url), "utf8")
  const shareSql = await readFile(new URL("../supabase/migrations/20260824143000_compare_share_telemetry.sql", import.meta.url), "utf8")
  for (const event of ["search_completed", "product_viewed", "public_price_preview_seen", "price_query_succeeded", "login_prompt_clicked", "login_completed", "map_opened"]) assert.match(sql, new RegExp(`'${event}'`))
  assert.match(sql, /octet_length\(properties::text\) > 2048/)
  assert.match(sql, /properties - array\['email', 'query', 'name', 'address', 'ip', 'user_agent'\]/)
  assert.match(sql, /revoke all on function public\.record_telemetry_event\(jsonb\) from public/)
  assert.match(sql, /grant execute on function public\.record_telemetry_event\(jsonb\) to anon, authenticated/)
  assert.match(sql, /perform public\.require_admin_user\(\)/)
  assert.match(sql, /group by session_id/)
  assert.match(sql, /'preview_to_login_percent'/)
  assert.match(sql, /'preview_to_login_intent_percent'/)
  assert.match(sql, /'price_to_map_percent'/)
  assert.match(sql, /grant execute on function public\.admin_fetch_telemetry_summary\(jsonb\) to authenticated/)
  assert.match(sql, /admin_fetch_telemetry_summary\(payload jsonb default '\{\}'::jsonb\)/)
  for (const event of ["compare_list_shared", "compare_list_opened"]) assert.match(shareSql, new RegExp(`'${event}'`))
  assert.match(shareSql, /properties - array\['email', 'query', 'name', 'address', 'ip', 'user_agent'\]/)
  assert.match(shareSql, /'share_sessions'/)
  assert.match(shareSql, /'shared_list_open_sessions'/)
  assert.match(shareSql, /admin_fetch_telemetry_summary\(payload jsonb default '\{\}'::jsonb\)/)
})

test("commercial telemetry events reject direct identifiers and exact location", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260831150000_expand_commercial_telemetry_events.sql", import.meta.url), "utf8")
  for (const event of ["compare_completed", "price_query_empty", "task_claimed", "task_submitted", "task_approved", "commercial_outbound_clicked", "favorite_revisited"]) assert.match(sql, new RegExp(`'${event}'`))
  for (const property of ["email", "query", "search_query", "search_term", "address", "location", "latitude", "longitude", "lat", "lng"]) assert.match(sql, new RegExp(`'${property}'`))
  assert.match(sql, /set search_path = public, pg_temp/)
  assert.match(sql, /revoke all on function public\.record_telemetry_event\(jsonb\) from public/)
  assert.match(sql, /grant execute on function public\.record_telemetry_event\(jsonb\) to anon, authenticated/)
})
