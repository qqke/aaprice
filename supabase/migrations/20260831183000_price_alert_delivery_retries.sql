alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));

alter table public.notification_deliveries
  add column if not exists attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  add column if not exists next_attempt_at timestamptz not null default now();

create index if not exists notification_deliveries_retry_idx
  on public.notification_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'processing', 'failed');

create or replace function public.claim_price_alert_deliveries(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_limit integer := case
    when coalesce(payload->>'limit', '') ~ '^\d+$'
      then least(50, greatest(1, (payload->>'limit')::integer))
    else 25
  end;
  result jsonb;
begin
  perform public.enqueue_price_alert_deliveries();

  with candidates as (
    select delivery.id
    from public.notification_deliveries delivery
    where delivery.status in ('pending', 'processing', 'failed')
      and delivery.next_attempt_at <= now()
      and delivery.attempt_count < 5
    order by delivery.created_at
    for update skip locked
    limit target_limit
  ),
  claimed as (
    update public.notification_deliveries delivery
    set
      status = 'processing',
      attempt_count = delivery.attempt_count + 1,
      next_attempt_at = now() + interval '10 minutes'
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', claimed.id,
    'email', account.email,
    'product_id', claimed.product_id,
    'product_name', product.name,
    'price_yen', claimed.price_yen,
    'target_price_yen', alert.target_price_yen,
    'idempotency_key', claimed.idempotency_key,
    'attempt_count', claimed.attempt_count
  ) order by claimed.created_at), '[]'::jsonb)
  into result
  from claimed
  join auth.users account on account.id = claimed.user_id
  join public.products product on product.id = claimed.product_id
  join public.price_alerts alert on alert.id = claimed.alert_id;

  return result;
end;
$$;

create or replace function public.complete_price_alert_delivery(payload jsonb)
returns public.notification_deliveries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid := nullif(payload->>'delivery_id', '')::uuid;
  succeeded boolean := coalesce((payload->>'succeeded')::boolean, false);
  result public.notification_deliveries;
begin
  update public.notification_deliveries delivery
  set
    status = case when succeeded then 'sent' else 'failed' end,
    provider_message_id = case when succeeded then left(coalesce(payload->>'provider_message_id', ''), 200) else '' end,
    error_message = case when succeeded then '' else left(coalesce(payload->>'error_message', 'Unknown delivery error'), 1000) end,
    sent_at = case when succeeded then now() else null end,
    next_attempt_at = case
      when succeeded then delivery.next_attempt_at
      when delivery.attempt_count = 1 then now() + interval '5 minutes'
      when delivery.attempt_count = 2 then now() + interval '15 minutes'
      when delivery.attempt_count = 3 then now() + interval '1 hour'
      else now() + interval '6 hours'
    end
  where delivery.id = target_id
    and delivery.status = 'processing'
  returning * into result;

  if result.id is null then
    raise exception 'price alert delivery is not processing';
  end if;

  return result;
end;
$$;

revoke all on function public.claim_price_alert_deliveries(jsonb) from public;
revoke all on function public.complete_price_alert_delivery(jsonb) from public;
grant execute on function public.claim_price_alert_deliveries(jsonb) to service_role;
grant execute on function public.complete_price_alert_delivery(jsonb) to service_role;

notify pgrst, 'reload schema';
