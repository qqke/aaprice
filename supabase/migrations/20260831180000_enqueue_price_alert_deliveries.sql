create or replace function public.enqueue_price_alert_deliveries()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queued_count integer;
begin
  with latest_store_prices as (
    select distinct on (price.product_id, price.store_id)
      price.product_id,
      price.store_id,
      price.price_yen
    from public.prices price
    where price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
      and price.collected_at >= now() - interval '30 days'
    order by price.product_id, price.store_id, price.collected_at desc
  ),
  current_prices as (
    select latest.product_id, min(latest.price_yen)::integer as price_yen
    from latest_store_prices latest
    group by latest.product_id
  ),
  queued as (
    insert into public.notification_deliveries (
      alert_id,
      user_id,
      product_id,
      channel,
      price_yen,
      idempotency_key
    )
    select
      alert.id,
      alert.user_id,
      alert.product_id,
      'email',
      current.price_yen,
      alert.id::text || ':' || current.price_yen::text
    from public.price_alerts alert
    join current_prices current on current.product_id = alert.product_id
    where alert.is_active = true
      and current.price_yen <= alert.target_price_yen
      and not exists (
        select 1
        from public.notification_deliveries prior
        where prior.alert_id = alert.id
          and prior.price_yen <= current.price_yen
      )
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::integer into queued_count from queued;

  return queued_count;
end;
$$;

revoke all on function public.enqueue_price_alert_deliveries() from public;
grant execute on function public.enqueue_price_alert_deliveries() to service_role;

notify pgrst, 'reload schema';
