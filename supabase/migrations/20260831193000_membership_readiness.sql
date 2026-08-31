create or replace function public.admin_fetch_membership_readiness(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$'
      then least(90, greatest(14, (payload->>'days')::integer))
    else 30
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  with filtered_events as (
    select user_id, event_name, occurred_at::date as activity_date
    from public.telemetry_events
    where occurred_at >= now() - make_interval(days => target_days)
      and user_id is not null
  ),
  user_days as (
    select distinct user_id, activity_date
    from filtered_events
  ),
  returning_users as (
    select distinct first_day.user_id
    from user_days first_day
    join user_days later_day on later_day.user_id = first_day.user_id
      and later_day.activity_date > first_day.activity_date
      and later_day.activity_date <= first_day.activity_date + 7
  ),
  price_query_users as (
    select user_id, count(distinct activity_date)::integer as query_days
    from filtered_events
    where event_name = 'price_query_succeeded'
    group by user_id
  ),
  metrics as (
    select
      (select count(distinct user_id) from filtered_events)::integer as active_users,
      (select count(*) from returning_users)::integer as returning_users,
      (select count(*) from price_query_users)::integer as price_query_users,
      (select count(*) from price_query_users where query_days >= 2)::integer as repeat_price_query_users
  )
  select jsonb_build_object(
    'days', target_days,
    'active_users', active_users,
    'returning_users', returning_users,
    'seven_day_return_percent', coalesce(round(100.0 * returning_users / nullif(active_users, 0), 1), 0),
    'price_query_users', price_query_users,
    'repeat_price_query_users', repeat_price_query_users,
    'repeat_price_query_percent', coalesce(round(100.0 * repeat_price_query_users / nullif(price_query_users, 0), 1), 0),
    'retention_gate_met', coalesce(100.0 * returning_users / nullif(active_users, 0) >= 15, false),
    'repeat_usage_gate_met', repeat_price_query_users >= 10
      and coalesce(100.0 * repeat_price_query_users / nullif(price_query_users, 0) >= 20, false),
    'membership_ready', coalesce(100.0 * returning_users / nullif(active_users, 0) >= 15, false)
      and repeat_price_query_users >= 10
      and coalesce(100.0 * repeat_price_query_users / nullif(price_query_users, 0) >= 20, false)
  ) into result
  from metrics;

  return result;
end;
$$;

revoke all on function public.admin_fetch_membership_readiness(jsonb) from public;
grant execute on function public.admin_fetch_membership_readiness(jsonb) to authenticated;

notify pgrst, 'reload schema';
