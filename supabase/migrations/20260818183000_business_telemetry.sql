create table if not exists public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid not null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.telemetry_events
  add column if not exists session_id uuid;

create index if not exists telemetry_events_occurred_idx
  on public.telemetry_events (occurred_at desc);
create index if not exists telemetry_events_name_occurred_idx
  on public.telemetry_events (event_name, occurred_at desc);

alter table public.telemetry_events enable row level security;

create or replace function public.record_telemetry_event(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
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
    'map_opened'
  ) then
    raise exception 'unsupported telemetry event';
  end if;
  if target_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid telemetry session';
  end if;
  if jsonb_typeof(properties) <> 'object' or octet_length(properties::text) > 2048 then
    raise exception 'invalid telemetry properties';
  end if;

  properties := properties - array['email', 'query', 'name', 'address', 'ip', 'user_agent'];

  insert into public.telemetry_events (user_id, session_id, event_name, payload, occurred_at)
  values (auth.uid(), target_session::uuid, target_event, properties, now());
end;
$$;

revoke all on function public.record_telemetry_event(jsonb) from public;
grant execute on function public.record_telemetry_event(jsonb) to anon, authenticated;

create or replace function public.admin_fetch_telemetry_summary(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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

  with session_funnel as (
    select
      session_id,
      bool_or(event_name = 'search_completed') as searched,
      bool_or(event_name = 'product_viewed') as viewed_product,
      bool_or(event_name = 'public_price_preview_seen') as saw_preview,
      bool_or(event_name = 'price_query_succeeded') as queried_price,
      bool_or(event_name = 'login_prompt_clicked') as wanted_login,
      bool_or(event_name = 'login_completed') as logged_in,
      bool_or(event_name = 'map_opened') as opened_map
    from public.telemetry_events
    where occurred_at >= now() - make_interval(days => target_days)
      and session_id is not null
    group by session_id
  )
  select jsonb_build_object(
    'days', target_days,
    'sessions', count(*),
    'search_sessions', count(*) filter (where searched),
    'product_view_sessions', count(*) filter (where viewed_product),
    'preview_sessions', count(*) filter (where saw_preview),
    'price_query_sessions', count(*) filter (where queried_price),
    'login_intent_sessions', count(*) filter (where wanted_login),
    'login_completed_sessions', count(*) filter (where logged_in),
    'map_open_sessions', count(*) filter (where opened_map),
    'preview_to_login_intent_percent', coalesce(round(100.0 * count(*) filter (where saw_preview and wanted_login) / nullif(count(*) filter (where saw_preview), 0), 1), 0),
    'preview_to_login_percent', coalesce(round(100.0 * count(*) filter (where saw_preview and logged_in) / nullif(count(*) filter (where saw_preview), 0), 1), 0),
    'price_to_map_percent', coalesce(round(100.0 * count(*) filter (where queried_price and opened_map) / nullif(count(*) filter (where queried_price), 0), 1), 0)
  ) into result
  from session_funnel;

  return result;
end;
$$;

revoke all on function public.admin_fetch_telemetry_summary(jsonb) from public;
grant execute on function public.admin_fetch_telemetry_summary(jsonb) to authenticated;

notify pgrst, 'reload schema';
