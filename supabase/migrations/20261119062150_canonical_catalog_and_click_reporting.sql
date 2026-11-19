-- External catalog IDs remain stable. Only valid-length numeric representations share an identity.
create or replace function public.catalog_gtin(barcode text)
returns text language sql immutable strict parallel safe set search_path = pg_catalog
as $$
  select case when barcode ~ '^([0-9]{8}|[0-9]{12,14})$' then lpad(barcode, 14, '0') end
$$;
grant execute on function public.catalog_gtin(text) to authenticated, service_role;

-- Existing collisions stop the migration for review, without moving or deleting any records.
create unique index products_catalog_gtin_uidx on public.products (public.catalog_gtin(barcode));

create or replace function public.register_scanned_product(payload jsonb)
returns public.products
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  barcode_value text := coalesce(payload->>'barcode', '');
  result public.products;
  pending_id uuid;
begin
  perform public.require_authenticated_user();
  if barcode_value !~ '^([0-9]{8}|[0-9]{12,14})$' then raise exception 'valid barcode required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('scanned-user:' || auth.uid()::text, 0));
  -- Serialize matching scans, including the first insert, without overwriting real metadata.
  perform pg_advisory_xact_lock(hashtextextended('scanned-product:' || public.catalog_gtin(barcode_value), 0));
  select * into result from public.products where public.catalog_gtin(barcode) = public.catalog_gtin(barcode_value) for update;
  if not found then
    if (select count(*) from public.product_submissions where user_id = auth.uid() and created_at >= now() - interval '1 day') >= 100 then
      raise exception 'daily product registration limit reached';
    end if;
    insert into public.products(id, barcode, name, catalog_source, needs_details)
    values(barcode_value, barcode_value, '待完善商品 · JAN ' || barcode_value, 'scan_stub', true)
    on conflict do nothing returning * into result;
    if not found then
      select * into strict result from public.products
      where public.catalog_gtin(barcode) = public.catalog_gtin(barcode_value) for update;
    end if;
  end if;
  if result.needs_details then
    select id into pending_id from public.product_submissions
      where public.catalog_gtin(barcode) = public.catalog_gtin(result.barcode) and review_status = 'pending' order by created_at limit 1 for update;
    if pending_id is null then
      insert into public.product_submissions(user_id, barcode, name, promoted_product_id)
      values(auth.uid(), result.barcode, result.name, result.id);
    else
      update public.product_submissions set promoted_product_id = result.id where id = pending_id;
    end if;
  end if;
  return result;
end;
$$;
revoke execute on function public.register_scanned_product(jsonb) from public, anon;
grant execute on function public.register_scanned_product(jsonb) to authenticated;

create or replace function public.admin_fetch_telemetry_summary(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$'
      then least(90, greatest(1, (payload->>'days')::integer))
    else 7
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  with filtered_events as (
    select user_id, session_id, event_name, occurred_at
    from public.telemetry_events
    where occurred_at >= now() - make_interval(days => target_days)
      and event_name <> 'commercial_outbound_clicked'
    union all
    select user_id, session_id, 'commercial_outbound_clicked', clicked_at
    from public.commercial_clicks
    where clicked_at >= now() - make_interval(days => target_days)
  ),
  session_funnel as (
    select
      session_id,
      bool_or(event_name = 'search_completed') as searched,
      bool_or(event_name = 'product_viewed') as viewed_product,
      bool_or(event_name = 'public_price_preview_seen') as saw_preview,
      bool_or(event_name = 'price_query_succeeded') as queried_price,
      bool_or(event_name = 'price_query_empty') as empty_price_query,
      bool_or(event_name = 'login_prompt_clicked') as wanted_login,
      bool_or(event_name = 'login_completed') as logged_in,
      bool_or(event_name = 'map_opened') as opened_map,
      bool_or(event_name = 'compare_completed') as completed_compare,
      bool_or(event_name = 'commercial_outbound_clicked') as clicked_commercial,
      bool_or(event_name = 'compare_list_shared') as shared_list,
      bool_or(event_name = 'compare_list_opened') as opened_shared_list
    from filtered_events
    where session_id is not null
    group by session_id
  ),
  user_days as (
    select distinct user_id, occurred_at::date as activity_date
    from filtered_events
    where user_id is not null
  ),
  returning_users as (
    select distinct first_day.user_id
    from user_days first_day
    join user_days later_day on later_day.user_id = first_day.user_id
      and later_day.activity_date > first_day.activity_date
      and later_day.activity_date <= first_day.activity_date + 7
  ),
  session_summary as (
    select
      count(*) as sessions,
      count(*) filter (where searched) as search_sessions,
      count(*) filter (where viewed_product) as product_view_sessions,
      count(*) filter (where saw_preview) as preview_sessions,
      count(*) filter (where queried_price) as price_query_sessions,
      count(*) filter (where empty_price_query) as empty_price_query_sessions,
      count(*) filter (where wanted_login) as login_intent_sessions,
      count(*) filter (where logged_in) as login_completed_sessions,
      count(*) filter (where opened_map) as map_open_sessions,
      count(*) filter (where completed_compare) as compare_completed_sessions,
      count(*) filter (where clicked_commercial) as commercial_outbound_sessions,
      count(*) filter (where shared_list) as share_sessions,
      count(*) filter (where opened_shared_list) as shared_list_open_sessions,
      count(*) filter (where saw_preview and wanted_login) as preview_login_intent_sessions,
      count(*) filter (where saw_preview and logged_in) as preview_login_sessions,
      count(*) filter (where queried_price and opened_map) as price_map_sessions,
      count(*) filter (where queried_price and (opened_map or completed_compare or clicked_commercial)) as price_action_sessions
    from session_funnel
  ),
  event_summary as (
    select
      count(*) filter (where event_name = 'task_claimed') as tasks_claimed,
      count(*) filter (where event_name = 'task_submitted') as tasks_submitted,
      count(*) filter (where event_name = 'task_approved') as tasks_approved,
      count(*) filter (where event_name = 'favorite_revisited') as favorite_revisits,
      count(distinct user_id) filter (where user_id is not null) as active_users
    from filtered_events
  ),
  credit_summary as (
    select
      coalesce(sum(amount) filter (where amount > 0), 0) as credits_issued,
      coalesce(-sum(amount) filter (where amount < 0), 0) as credits_spent
    from public.credit_ledger
    where created_at >= now() - make_interval(days => target_days)
  )
  select jsonb_build_object(
    'days', target_days,
    'sessions', sessions,
    'search_sessions', search_sessions,
    'product_view_sessions', product_view_sessions,
    'preview_sessions', preview_sessions,
    'price_query_sessions', price_query_sessions,
    'price_query_empty_sessions', empty_price_query_sessions,
    'login_intent_sessions', login_intent_sessions,
    'login_completed_sessions', login_completed_sessions,
    'map_open_sessions', map_open_sessions,
    'compare_completed_sessions', compare_completed_sessions,
    'commercial_outbound_sessions', commercial_outbound_sessions,
    'share_sessions', share_sessions,
    'shared_list_open_sessions', shared_list_open_sessions,
    'tasks_claimed', tasks_claimed,
    'tasks_submitted', tasks_submitted,
    'tasks_approved', tasks_approved,
    'favorite_revisits', favorite_revisits,
    'active_users', active_users,
    'seven_day_return_users', (select count(*) from returning_users),
    'credits_issued', credits_issued,
    'credits_spent', credits_spent,
    'preview_to_login_intent_percent', coalesce(round(100.0 * preview_login_intent_sessions / nullif(preview_sessions, 0), 1), 0),
    'preview_to_login_percent', coalesce(round(100.0 * preview_login_sessions / nullif(preview_sessions, 0), 1), 0),
    'price_to_map_percent', coalesce(round(100.0 * price_map_sessions / nullif(price_query_sessions, 0), 1), 0),
    'price_query_empty_percent', coalesce(round(100.0 * empty_price_query_sessions / nullif(price_query_sessions + empty_price_query_sessions, 0), 1), 0),
    'price_to_action_percent', coalesce(round(100.0 * price_action_sessions / nullif(price_query_sessions, 0), 1), 0),
    'task_claim_to_submit_percent', coalesce(round(100.0 * tasks_submitted / nullif(tasks_claimed, 0), 1), 0),
    'task_claim_to_approval_percent', coalesce(round(100.0 * tasks_approved / nullif(tasks_claimed, 0), 1), 0),
    'seven_day_return_percent', coalesce(round(100.0 * (select count(*) from returning_users) / nullif(active_users, 0), 1), 0)
  ) into result
  from session_summary
  cross join event_summary
  cross join credit_summary;

  return result;
end;
$$;

revoke all on function public.admin_fetch_telemetry_summary(jsonb) from public;
grant execute on function public.admin_fetch_telemetry_summary(jsonb) to authenticated;

notify pgrst, 'reload schema';
