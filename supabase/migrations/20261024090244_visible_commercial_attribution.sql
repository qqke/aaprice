create or replace function public.admin_fetch_commercial_validation(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$' then least(365, greatest(1, (payload->>'days')::numeric))::integer
    else 30
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  with visible_exposures as materialized (
    select event.session_id, event.occurred_at,
      event.payload->>'source' as source, event.payload->>'offer_id' as offer_id
    from public.telemetry_events event
    where event.event_name = 'commercial_offer_seen'
      and event.payload->>'measurement' = 'viewport_v1'
      and event.payload->>'source' in ('product', 'compare')
      and event.payload->>'offer_id' is not null
      and event.occurred_at between now() - make_interval(days => target_days) and now()
  ),
  exposure as (
    select min(occurred_at) as tracking_started_at,
      count(distinct session_id)::integer as eligible_sessions,
      count(distinct session_id) filter (where source = 'product')::integer as product_sessions,
      count(distinct session_id) filter (where source = 'compare')::integer as compare_sessions
    from visible_exposures
  ),
  clicks as (
    select count(distinct click.session_id)::integer as click_sessions,
      count(distinct click.session_id) filter (where click.source = 'product')::integer as product_click_sessions,
      count(distinct click.session_id) filter (where click.source = 'compare')::integer as compare_click_sessions
    from public.commercial_clicks click
    where click.clicked_at between now() - make_interval(days => target_days) and now()
      and exists (
        select 1 from visible_exposures event
        where event.session_id = click.session_id and event.source = click.source
          and event.offer_id = click.offer_id::text and event.occurred_at <= click.clicked_at
      )
  ),
  coverage as (
    select count(*) filter (where is_active)::integer as active_offers,
      count(distinct product_id) filter (where is_active)::integer as covered_products
    from public.commercial_offers
  )
  select jsonb_build_object(
    'days', target_days, 'measurement', 'viewport_v1',
    'tracking_started_at', exposure.tracking_started_at,
    'eligible_sessions', exposure.eligible_sessions,
    'click_sessions', clicks.click_sessions,
    'outbound_click_percent', round(100.0 * clicks.click_sessions / nullif(exposure.eligible_sessions, 0), 1),
    'product_sessions', exposure.product_sessions, 'product_click_sessions', clicks.product_click_sessions,
    'compare_sessions', exposure.compare_sessions, 'compare_click_sessions', clicks.compare_click_sessions,
    'active_offers', coverage.active_offers, 'covered_products', coverage.covered_products
  ) into result from exposure cross join clicks cross join coverage;
  return result;
end;
$$;

revoke all on function public.admin_fetch_commercial_validation(jsonb) from public, anon;
grant execute on function public.admin_fetch_commercial_validation(jsonb) to authenticated;
notify pgrst, 'reload schema';
