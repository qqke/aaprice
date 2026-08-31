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

revoke all on function public.record_telemetry_event(jsonb) from public;
grant execute on function public.record_telemetry_event(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
