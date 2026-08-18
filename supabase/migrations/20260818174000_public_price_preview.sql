create index if not exists prices_product_store_collected_idx
  on public.prices (product_id, store_id, collected_at desc);

create or replace function public.fetch_public_product_price_preview(payload jsonb)
returns table (
  min_price_yen integer,
  store_count integer,
  latest_collected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_product_id text := nullif(btrim(payload->>'product_id'), '');
begin
  if target_product_id is null then
    raise exception 'product_id is required';
  end if;

  return query
  select
    min(latest.price_yen)::integer,
    count(*)::integer,
    max(latest.collected_at)
  from (
    select distinct on (p.store_id)
      p.store_id,
      p.price_yen,
      p.collected_at
    from public.prices p
    where p.product_id = target_product_id
      and p.price_yen > 0
      and coalesce(p.is_member_price, false) = false
      and p.collected_at >= now() - interval '30 days'
    order by p.store_id, p.collected_at desc
  ) latest
  having count(*) > 0;
end;
$$;

revoke all on function public.fetch_public_product_price_preview(jsonb) from public;
grant execute on function public.fetch_public_product_price_preview(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
