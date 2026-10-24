-- These worker RPCs return private delivery data or mutate background queues.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

create or replace function public.claim_price_alert_deliveries(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_limit integer := case when coalesce(payload->>'limit', '') ~ '^\d+$'
    then least(50, greatest(1, (payload->>'limit')::numeric))::integer else 25 end;
  result jsonb;
begin
  perform public.enqueue_price_alert_deliveries();
  with candidates as (
    select delivery.id
    from public.notification_deliveries delivery
    join public.price_alerts alert on alert.id = delivery.alert_id
      and alert.user_id = delivery.user_id and alert.product_id = delivery.product_id
    join auth.users account on account.id = delivery.user_id
    where delivery.status in ('pending', 'processing', 'failed')
      and delivery.next_attempt_at <= now() and delivery.attempt_count < 5
      and alert.is_active and delivery.price_yen <= alert.target_price_yen
      and account.email_confirmed_at is not null
    order by delivery.created_at
    for update of delivery skip locked
    limit target_limit
  ),
  claimed as (
    update public.notification_deliveries delivery
    set status = 'processing', attempt_count = delivery.attempt_count + 1,
      next_attempt_at = now() + interval '10 minutes'
    from candidates where delivery.id = candidates.id
    returning delivery.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', claimed.id, 'email', account.email, 'product_id', claimed.product_id,
    'product_name', product.name, 'price_yen', claimed.price_yen,
    'target_price_yen', alert.target_price_yen, 'idempotency_key', claimed.idempotency_key,
    'attempt_count', claimed.attempt_count
  ) order by claimed.created_at), '[]'::jsonb)
  into result from claimed
  join auth.users account on account.id = claimed.user_id
  join public.products product on product.id = claimed.product_id
  join public.price_alerts alert on alert.id = claimed.alert_id;
  return result;
end;
$$;

revoke all on function public.claim_price_alert_deliveries(jsonb) from public, anon, authenticated;
revoke all on function public.complete_price_alert_delivery(jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_price_alert_deliveries() from public, anon, authenticated;
revoke all on function public.refill_price_tasks(jsonb) from public, anon, authenticated;
grant execute on function public.claim_price_alert_deliveries(jsonb) to service_role;
grant execute on function public.complete_price_alert_delivery(jsonb) to service_role;
grant execute on function public.enqueue_price_alert_deliveries() to service_role;
grant execute on function public.refill_price_tasks(jsonb) to service_role;

create or replace function public.admin_fetch_telemetry_recent(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  row_limit integer := case when coalesce(payload->>'limit', '') ~ '^\d+$'
    then least(200, greatest(1, (payload->>'limit')::numeric))::integer else 30 end;
begin
  perform public.require_admin_user();
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(item) order by item.occurred_at desc, item.id desc), '[]'::jsonb))
  into result from (
    select event.id, event.user_id, coalesce(profile.email, '') as email,
      event.event_name, event.payload, event.occurred_at
    from public.telemetry_events event
    left join public.profiles profile on profile.id = event.user_id
    order by event.occurred_at desc, event.id desc
    limit row_limit
  ) item;
  return result;
end;
$$;
revoke all on function public.admin_fetch_telemetry_recent(jsonb) from public, anon;
grant execute on function public.admin_fetch_telemetry_recent(jsonb) to authenticated;

do $$
declare
  signature text;
begin
  for signature in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and left(p.proname, 6) = 'admin_'
  loop
    execute format('revoke execute on function %s from public, anon', signature);
  end loop;
end;
$$;
notify pgrst, 'reload schema';
