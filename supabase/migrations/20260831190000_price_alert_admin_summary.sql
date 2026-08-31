create or replace function public.admin_fetch_price_alert_summary(payload jsonb default '{}'::jsonb)
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

  select jsonb_build_object(
    'days', target_days,
    'total_alerts', (select count(*) from public.price_alerts),
    'active_alerts', (select count(*) from public.price_alerts where is_active = true),
    'queued_deliveries', (select count(*) from public.notification_deliveries where status in ('pending', 'processing')),
    'retrying_deliveries', (select count(*) from public.notification_deliveries where status = 'failed' and attempt_count < 5),
    'terminal_failures', (select count(*) from public.notification_deliveries where status = 'failed' and attempt_count >= 5),
    'sent_deliveries', (
      select count(*) from public.notification_deliveries
      where status = 'sent' and sent_at >= now() - make_interval(days => target_days)
    ),
    'delivery_success_percent', coalesce((
      select round(100.0 * count(*) filter (where status = 'sent') / nullif(count(*), 0), 1)
      from public.notification_deliveries
      where created_at >= now() - make_interval(days => target_days)
        and (status = 'sent' or (status = 'failed' and attempt_count >= 5))
    ), 0),
    'recent_failures', coalesce((
      select jsonb_agg(to_jsonb(failure) order by failure.created_at desc)
      from (
        select
          delivery.id,
          delivery.product_id,
          product.name as product_name,
          delivery.price_yen,
          delivery.attempt_count,
          delivery.error_message,
          delivery.next_attempt_at,
          delivery.created_at,
          delivery.attempt_count < 5 as will_retry
        from public.notification_deliveries delivery
        join public.products product on product.id = delivery.product_id
        where delivery.status = 'failed'
        order by delivery.created_at desc
        limit 10
      ) failure
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_fetch_price_alert_summary(jsonb) from public;
grant execute on function public.admin_fetch_price_alert_summary(jsonb) to authenticated;

notify pgrst, 'reload schema';
