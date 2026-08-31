create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  target_price_yen integer not null check (target_price_yen > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

drop trigger if exists price_alerts_updated_at on public.price_alerts;
create trigger price_alerts_updated_at
before update on public.price_alerts
for each row execute function public.set_updated_at();

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.price_alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  channel text not null check (channel in ('email')),
  price_yen integer not null check (price_yen > 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  provider_message_id text not null default '',
  error_message text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists price_alerts_active_product_idx
  on public.price_alerts (is_active, product_id);
create index if not exists notification_deliveries_status_idx
  on public.notification_deliveries (status, created_at);
create index if not exists notification_deliveries_user_idx
  on public.notification_deliveries (user_id, created_at desc);

alter table public.price_alerts enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table public.price_alerts from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;

create or replace function public.fetch_my_price_alerts()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(alert_row) order by alert_row.updated_at desc), '[]'::jsonb)
  from (
    select
      alert.id,
      alert.product_id,
      product.name as product_name,
      alert.target_price_yen,
      alert.is_active,
      alert.created_at,
      alert.updated_at,
      delivery.status as last_delivery_status,
      delivery.price_yen as last_delivery_price_yen,
      delivery.sent_at as last_sent_at
    from public.price_alerts alert
    join public.products product on product.id = alert.product_id
    left join lateral (
      select sent.status, sent.price_yen, sent.sent_at
      from public.notification_deliveries sent
      where sent.alert_id = alert.id
      order by sent.created_at desc
      limit 1
    ) delivery on true
    where alert.user_id = auth.uid()
    order by alert.updated_at desc
  ) alert_row;
$$;

create or replace function public.upsert_price_alert(payload jsonb)
returns public.price_alerts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_product_id text := coalesce(payload->>'product_id', '');
  target_price integer := case
    when coalesce(payload->>'target_price_yen', '') ~ '^\d+$' then (payload->>'target_price_yen')::integer
    else 0
  end;
  result public.price_alerts;
begin
  perform public.require_authenticated_user();

  if target_product_id = '' or target_price <= 0 then
    raise exception 'product_id and target_price_yen are required';
  end if;

  insert into public.price_alerts (user_id, product_id, target_price_yen, is_active)
  values (
    auth.uid(),
    target_product_id,
    target_price,
    coalesce((payload->>'is_active')::boolean, true)
  )
  on conflict (user_id, product_id) do update set
    target_price_yen = excluded.target_price_yen,
    is_active = excluded.is_active
  returning * into result;

  return result;
end;
$$;

revoke all on function public.fetch_my_price_alerts() from public;
revoke all on function public.upsert_price_alert(jsonb) from public;
grant execute on function public.fetch_my_price_alerts() to authenticated;
grant execute on function public.upsert_price_alert(jsonb) to authenticated;

notify pgrst, 'reload schema';
