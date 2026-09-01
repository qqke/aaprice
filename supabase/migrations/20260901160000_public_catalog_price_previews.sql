create or replace function public.fetch_public_catalog_price_previews(payload jsonb)
returns table (
  product_id text,
  min_price_yen integer,
  store_count integer,
  latest_collected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(coalesce(payload->'product_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'product_ids must be an array';
  end if;
  if jsonb_array_length(coalesce(payload->'product_ids', '[]'::jsonb)) > 100 then
    raise exception 'product_ids supports at most 100 items';
  end if;

  return query
  with requested as (
    select distinct nullif(btrim(value), '') as product_id
    from jsonb_array_elements_text(coalesce(payload->'product_ids', '[]'::jsonb)) ids(value)
  ), latest as (
    select distinct on (price.product_id, price.store_id)
      price.product_id,
      price.store_id,
      price.price_yen,
      price.collected_at
    from public.prices price
    join requested on requested.product_id = price.product_id
    where requested.product_id is not null
      and price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
      and price.collected_at >= now() - interval '30 days'
    order by price.product_id, price.store_id, price.collected_at desc
  )
  select
    latest.product_id,
    min(latest.price_yen)::integer,
    count(*)::integer,
    max(latest.collected_at)
  from latest
  group by latest.product_id;
end;
$$;

revoke all on function public.fetch_public_catalog_price_previews(jsonb) from public;
grant execute on function public.fetch_public_catalog_price_previews(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
