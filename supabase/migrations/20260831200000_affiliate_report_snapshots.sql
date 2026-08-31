create table if not exists public.affiliate_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  partner text not null check (partner ~ '^[a-z0-9_-]{2,40}$'),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  result_status text not null check (result_status in ('pending', 'confirmed', 'discarded')),
  clicks integer not null default 0 check (clicks >= 0),
  orders integer not null default 0 check (orders >= 0),
  sales_yen integer not null default 0 check (sales_yen >= 0),
  commission_yen integer not null default 0 check (commission_yen >= 0),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner, period_start, period_end, result_status)
);

drop trigger if exists affiliate_report_snapshots_updated_at on public.affiliate_report_snapshots;
create trigger affiliate_report_snapshots_updated_at
before update on public.affiliate_report_snapshots
for each row execute function public.set_updated_at();

alter table public.affiliate_report_snapshots enable row level security;
revoke all on table public.affiliate_report_snapshots from anon, authenticated;

create or replace function public.admin_fetch_affiliate_reports(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$'
      then least(730, greatest(30, (payload->>'days')::integer))
    else 180
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  select jsonb_build_object(
    'days', target_days,
    'confirmed_orders', coalesce(sum(report.orders) filter (where report.result_status = 'confirmed'), 0),
    'confirmed_sales_yen', coalesce(sum(report.sales_yen) filter (where report.result_status = 'confirmed'), 0),
    'confirmed_commission_yen', coalesce(sum(report.commission_yen) filter (where report.result_status = 'confirmed'), 0),
    'pending_commission_yen', coalesce(sum(report.commission_yen) filter (where report.result_status = 'pending'), 0),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.period_end desc, item.partner, item.result_status)
      from (
        select *
        from public.affiliate_report_snapshots
        order by period_end desc, updated_at desc
        limit 36
      ) item
    ), '[]'::jsonb)
  ) into result
  from public.affiliate_report_snapshots report
  where report.period_end >= current_date - target_days;

  return result;
end;
$$;

create or replace function public.admin_upsert_affiliate_report(payload jsonb)
returns public.affiliate_report_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_partner text := lower(trim(coalesce(payload->>'partner', '')));
  target_status text := coalesce(payload->>'result_status', '');
  target_start date;
  target_end date;
  target_clicks integer := case when coalesce(payload->>'clicks', '') ~ '^\d+$' then (payload->>'clicks')::integer else -1 end;
  target_orders integer := case when coalesce(payload->>'orders', '') ~ '^\d+$' then (payload->>'orders')::integer else -1 end;
  target_sales integer := case when coalesce(payload->>'sales_yen', '') ~ '^\d+$' then (payload->>'sales_yen')::integer else -1 end;
  target_commission integer := case when coalesce(payload->>'commission_yen', '') ~ '^\d+$' then (payload->>'commission_yen')::integer else -1 end;
  result public.affiliate_report_snapshots;
begin
  perform public.require_admin_user();

  if target_partner !~ '^[a-z0-9_-]{2,40}$'
    or target_status not in ('pending', 'confirmed', 'discarded')
    or coalesce(payload->>'period_start', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(payload->>'period_end', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or least(target_clicks, target_orders, target_sales, target_commission) < 0 then
    raise exception 'invalid affiliate report';
  end if;

  target_start := (payload->>'period_start')::date;
  target_end := (payload->>'period_end')::date;
  if target_end < target_start then raise exception 'period_end must not precede period_start'; end if;

  insert into public.affiliate_report_snapshots (
    partner, period_start, period_end, result_status, clicks, orders, sales_yen, commission_yen, note
  ) values (
    target_partner, target_start, target_end, target_status, target_clicks, target_orders,
    target_sales, target_commission, left(trim(coalesce(payload->>'note', '')), 500)
  )
  on conflict (partner, period_start, period_end, result_status) do update set
    clicks = excluded.clicks,
    orders = excluded.orders,
    sales_yen = excluded.sales_yen,
    commission_yen = excluded.commission_yen,
    note = excluded.note
  returning * into result;

  return result;
end;
$$;

revoke all on function public.admin_fetch_affiliate_reports(jsonb) from public;
revoke all on function public.admin_upsert_affiliate_report(jsonb) from public;
grant execute on function public.admin_fetch_affiliate_reports(jsonb) to authenticated;
grant execute on function public.admin_upsert_affiliate_report(jsonb) to authenticated;

notify pgrst, 'reload schema';
