create table if not exists public.commercial_offers (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  store_id text references public.stores(id) on delete set null,
  partner text not null check (partner ~ '^[a-z0-9_-]{2,40}$'),
  campaign text not null default '' check (char_length(campaign) <= 100),
  destination_url text not null check (destination_url ~* '^https://'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_offers_product_active_idx
  on public.commercial_offers (product_id, is_active, updated_at desc);

drop trigger if exists commercial_offers_updated_at on public.commercial_offers;
create trigger commercial_offers_updated_at
before update on public.commercial_offers
for each row execute function public.set_updated_at();

create table if not exists public.commercial_clicks (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.commercial_offers(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid not null,
  source text not null check (source in ('product', 'compare')),
  clicked_at timestamptz not null default now()
);

create index if not exists commercial_clicks_offer_time_idx
  on public.commercial_clicks (offer_id, clicked_at desc);
create index if not exists commercial_clicks_time_idx
  on public.commercial_clicks (clicked_at desc);

alter table public.commercial_offers enable row level security;
alter table public.commercial_clicks enable row level security;

drop policy if exists "commercial offers admin manage" on public.commercial_offers;
create policy "commercial offers admin manage" on public.commercial_offers
  for all using (public.is_admin_user()) with check (public.is_admin_user());

revoke all on table public.commercial_offers from anon, authenticated;
revoke all on table public.commercial_clicks from anon, authenticated;

create or replace function public.fetch_commercial_offers(payload jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(offer) order by offer.product_id, offer.updated_at desc), '[]'::jsonb)
  from (
    select id, product_id, store_id, partner, campaign
    from public.commercial_offers
    where is_active = true
      and (
        coalesce(payload->'product_ids', '[]'::jsonb) = '[]'::jsonb
        or coalesce(payload->'product_ids', '[]'::jsonb) ? product_id
      )
    limit 100
  ) offer;
$$;

create or replace function public.record_commercial_click(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_offer uuid;
  target_session uuid;
  target_source text := coalesce(payload->>'source', '');
  target_url text;
begin
  if coalesce(payload->>'offer_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(payload->>'session_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or target_source not in ('product', 'compare') then
    raise exception 'invalid commercial click';
  end if;

  target_offer := (payload->>'offer_id')::uuid;
  target_session := (payload->>'session_id')::uuid;

  select destination_url into target_url
  from public.commercial_offers
  where id = target_offer and is_active = true;

  if target_url is null then
    raise exception 'commercial offer unavailable';
  end if;

  insert into public.commercial_clicks (offer_id, user_id, session_id, source)
  values (target_offer, auth.uid(), target_session, target_source);

  return target_url;
end;
$$;

revoke all on function public.fetch_commercial_offers(jsonb) from public;
revoke all on function public.record_commercial_click(jsonb) from public;
grant execute on function public.fetch_commercial_offers(jsonb) to anon, authenticated;
grant execute on function public.record_commercial_click(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
