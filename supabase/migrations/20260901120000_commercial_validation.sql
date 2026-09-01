create or replace function public.record_telemetry_event(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event text := coalesce(payload->>'event_name', '');
  target_session text := coalesce(payload->>'session_id', '');
  properties jsonb := coalesce(payload->'properties', '{}'::jsonb);
begin
  if target_event not in (
    'search_completed',
    'product_viewed',
    'public_price_preview_seen',
    'price_query_succeeded',
    'login_prompt_clicked',
    'login_completed',
    'map_opened',
    'compare_list_shared',
    'compare_list_opened',
    'compare_completed',
    'price_query_empty',
    'task_claimed',
    'task_submitted',
    'task_approved',
    'commercial_offer_seen',
    'commercial_outbound_clicked',
    'favorite_revisited'
  ) then
    raise exception 'unsupported telemetry event';
  end if;
  if target_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid telemetry session';
  end if;
  if jsonb_typeof(properties) <> 'object' or octet_length(properties::text) > 2048 then
    raise exception 'invalid telemetry properties';
  end if;

  properties := properties - array[
    'email', 'query', 'search_query', 'search_term', 'name', 'address',
    'ip', 'user_agent', 'location', 'latitude', 'longitude', 'lat', 'lng'
  ];

  insert into public.telemetry_events (user_id, session_id, event_name, payload, occurred_at)
  values (auth.uid(), target_session::uuid, target_event, properties, now());
end;
$$;

create or replace function public.admin_fetch_commercial_validation(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$' then least(365, greatest(1, (payload->>'days')::integer))
    else 30
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  with exposure as (
    select
      min(event.occurred_at) as tracking_started_at,
      count(distinct event.session_id)::integer as eligible_sessions,
      count(distinct event.session_id) filter (where event.payload->>'source' = 'product')::integer as product_sessions,
      count(distinct event.session_id) filter (where event.payload->>'source' = 'compare')::integer as compare_sessions
    from public.telemetry_events event
    where event.event_name = 'commercial_offer_seen'
      and event.occurred_at >= now() - make_interval(days => target_days)
  ),
  clicks as (
    select
      count(distinct click.session_id)::integer as click_sessions,
      count(distinct click.session_id) filter (where click.source = 'product')::integer as product_click_sessions,
      count(distinct click.session_id) filter (where click.source = 'compare')::integer as compare_click_sessions
    from public.commercial_clicks click
    cross join exposure
    where exposure.tracking_started_at is not null
      and click.clicked_at >= exposure.tracking_started_at
  ),
  coverage as (
    select
      count(*) filter (where is_active)::integer as active_offers,
      count(distinct product_id) filter (where is_active)::integer as covered_products
    from public.commercial_offers
  )
  select jsonb_build_object(
    'days', target_days,
    'tracking_started_at', exposure.tracking_started_at,
    'eligible_sessions', exposure.eligible_sessions,
    'click_sessions', clicks.click_sessions,
    'outbound_click_percent', coalesce(round(100.0 * clicks.click_sessions / nullif(exposure.eligible_sessions, 0), 1), 0),
    'product_sessions', exposure.product_sessions,
    'product_click_sessions', clicks.product_click_sessions,
    'compare_sessions', exposure.compare_sessions,
    'compare_click_sessions', clicks.compare_click_sessions,
    'active_offers', coverage.active_offers,
    'covered_products', coverage.covered_products
  ) into result
  from exposure
  cross join clicks
  cross join coverage;

  return result;
end;
$$;

revoke all on function public.record_telemetry_event(jsonb) from public;
grant execute on function public.record_telemetry_event(jsonb) to anon, authenticated;
revoke all on function public.admin_fetch_commercial_validation(jsonb) from public;
grant execute on function public.admin_fetch_commercial_validation(jsonb) to authenticated;

notify pgrst, 'reload schema';
