create or replace function public.fetch_public_ranked_products(payload jsonb)
returns setof public.products
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_limit integer := least(100, greatest(1, coalesce((payload->>'limit')::integer, 30)));
  target_offset integer := greatest(0, coalesce((payload->>'offset')::integer, 0));
begin
  return query
  with engagement as (
    select
      event.payload->>'product_id' as product_id,
      count(*) filter (where event.event_name = 'product_viewed') * 3
        + count(*) filter (where event.event_name = 'price_query_succeeded') * 8
        + count(*) filter (where event.event_name = 'favorite_revisited') * 10
        + count(*) filter (where event.event_name = 'map_opened') * 5 as score
    from public.telemetry_events event
    where event.occurred_at >= now() - interval '90 days'
      and event.payload->>'product_id' <> ''
    group by event.payload->>'product_id'
  ), favorite_counts as (
    select favorite.entity_id as product_id, count(*) * 10 as score
    from public.favorites favorite
    where favorite.entity_type = 'product'
    group by favorite.entity_id
  ), current_prices as (
    select price.product_id, max(price.collected_at) as latest_price_at
    from public.prices price
    where price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
      and price.collected_at >= now() - interval '30 days'
    group by price.product_id
  )
  select product.*
  from public.products product
  left join current_prices current on current.product_id = product.id
  left join engagement on engagement.product_id = product.id
  left join favorite_counts on favorite_counts.product_id = product.id
  where concat_ws(' ', product.name, product.category) ~ '(医薬|薬用|化粧|コスメ|スキン|美容|サプリ|ビタミン|目薬|日焼け|シャンプー)'
  order by
    (current.product_id is not null) desc,
    coalesce(engagement.score, 0) + coalesce(favorite_counts.score, 0) desc,
    current.latest_price_at desc nulls last,
    product.last_seen_at desc nulls last,
    product.id
  limit target_limit
  offset target_offset;
exception
  when invalid_text_representation then
    raise exception 'limit and offset must be integers';
end;
$$;

revoke all on function public.fetch_public_ranked_products(jsonb) from public;
grant execute on function public.fetch_public_ranked_products(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
