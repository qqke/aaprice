-- Fix the search path on existing SECURITY DEFINER functions reported by the audit.
begin;

alter function public.admin_adjust_credits(jsonb) set search_path = public, pg_temp;
alter function public.admin_fetch_telemetry_recent(jsonb) set search_path = public, pg_temp;
alter function public.admin_fetch_telemetry_summary(jsonb) set search_path = public, pg_temp;
alter function public.admin_review_price_submission(jsonb) set search_path = public, pg_temp;
alter function public.admin_review_product_submission(jsonb) set search_path = public, pg_temp;
alter function public.admin_update_app_setting(jsonb) set search_path = public, pg_temp;
alter function public.admin_upsert_product(jsonb) set search_path = public, pg_temp;
alter function public.app_setting_int(text, integer) set search_path = public, pg_temp;
alter function public.claim_random_price_task(jsonb) set search_path = public, pg_temp;
alter function public.consume_credit(uuid, integer, text, text, uuid, text) set search_path = public, pg_temp;
alter function public.consume_price_reference(text) set search_path = public, pg_temp;
alter function public.create_product(jsonb) set search_path = public, pg_temp;
alter function public.credit_balance(uuid) set search_path = public, pg_temp;
alter function public.fetch_app_settings() set search_path = public, pg_temp;
alter function public.fetch_credit_summary() set search_path = public, pg_temp;
alter function public.fetch_product_prices_page(jsonb) set search_path = public, pg_temp;
alter function public.fetch_product_prices(jsonb) set search_path = public, pg_temp;
alter function public.fetch_public_product_price_preview(jsonb) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.is_admin_user() set search_path = public, pg_temp;
alter function public.record_product_search(jsonb) set search_path = public, pg_temp;
alter function public.record_telemetry_event(jsonb) set search_path = public, pg_temp;
alter function public.require_admin_user() set search_path = public, pg_temp;
alter function public.require_authenticated_user() set search_path = public, pg_temp;
alter function public.rls_auto_enable() set search_path = public, pg_temp;
alter function public.skip_price_task(jsonb) set search_path = public, pg_temp;
alter function public.submit_product_submission(jsonb) set search_path = public, pg_temp;
alter function public.submit_store_price(jsonb) set search_path = public, pg_temp;
alter function public.submit_telemetry_events(jsonb) set search_path = public, pg_temp;
alter function public.try_promote_consensus_price(text, text, integer) set search_path = public, pg_temp;

-- Remove implicit PUBLIC execution, then grant only the client roles each RPC needs.
revoke execute on function public.admin_adjust_credits(jsonb) from public;
revoke execute on function public.admin_fetch_telemetry_recent(jsonb) from public;
revoke execute on function public.admin_review_price_submission(jsonb) from public;
revoke execute on function public.admin_review_product_submission(jsonb) from public;
revoke execute on function public.admin_update_app_setting(jsonb) from public;
revoke execute on function public.admin_upsert_product(jsonb) from public;
revoke execute on function public.claim_random_price_task(jsonb) from public;
revoke execute on function public.fetch_app_settings() from public;
revoke execute on function public.fetch_credit_summary() from public;
revoke execute on function public.fetch_product_prices_page(jsonb) from public;
revoke execute on function public.fetch_product_prices(jsonb) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.is_admin_user() from public;
revoke execute on function public.record_product_search(jsonb) from public;
revoke execute on function public.require_admin_user() from public;
revoke execute on function public.require_authenticated_user() from public;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.skip_price_task(jsonb) from public;
revoke execute on function public.submit_product_submission(jsonb) from public;
revoke execute on function public.submit_store_price(jsonb) from public;
revoke execute on function public.submit_telemetry_events(jsonb) from public;

grant execute on function public.admin_adjust_credits(jsonb) to authenticated;
grant execute on function public.admin_fetch_telemetry_recent(jsonb) to authenticated;
grant execute on function public.admin_review_price_submission(jsonb) to authenticated;
grant execute on function public.admin_review_product_submission(jsonb) to authenticated;
grant execute on function public.admin_update_app_setting(jsonb) to authenticated;
grant execute on function public.admin_upsert_product(jsonb) to authenticated;
grant execute on function public.claim_random_price_task(jsonb) to authenticated;
grant execute on function public.fetch_app_settings() to anon, authenticated;
grant execute on function public.fetch_credit_summary() to authenticated;
grant execute on function public.fetch_product_prices_page(jsonb) to authenticated;
grant execute on function public.fetch_product_prices(jsonb) to authenticated;
grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.record_product_search(jsonb) to authenticated;
grant execute on function public.skip_price_task(jsonb) to authenticated;
grant execute on function public.submit_product_submission(jsonb) to authenticated;
grant execute on function public.submit_store_price(jsonb) to authenticated;
grant execute on function public.submit_telemetry_events(jsonb) to anon, authenticated;

-- RLS does not govern these table-level operations; browser clients never need them.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

notify pgrst, 'reload schema';

commit;
