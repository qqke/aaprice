create or replace function public.fetch_favorite_price_changes(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$'
      then least(30, greatest(1, (payload->>'days')::integer))
    else 7
  end;
  result jsonb;
begin
  perform public.require_authenticated_user();

  with favorite_products as (
    select favorite.entity_id as product_id
    from public.favorites favorite
    where favorite.user_id = auth.uid()
      and favorite.entity_type = 'product'
  ),
  current_store_prices as (
    select distinct on (price.product_id, price.store_id)
      price.product_id,
      price.store_id,
      price.price_yen,
      price.collected_at
    from public.prices price
    join favorite_products favorite on favorite.product_id = price.product_id
    where price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
      and price.collected_at >= now() - make_interval(days => target_days)
    order by price.product_id, price.store_id, price.collected_at desc
  ),
  previous_store_prices as (
    select distinct on (price.product_id, price.store_id)
      price.product_id,
      price.store_id,
      price.price_yen
    from public.prices price
    join favorite_products favorite on favorite.product_id = price.product_id
    where price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
      and price.collected_at >= now() - make_interval(days => target_days * 2)
      and price.collected_at < now() - make_interval(days => target_days)
    order by price.product_id, price.store_id, price.collected_at desc
  ),
  current_summary as (
    select product_id, min(price_yen)::integer as current_min_price_yen, count(*)::integer as current_store_count, max(collected_at) as latest_collected_at
    from current_store_prices
    group by product_id
  ),
  previous_summary as (
    select product_id, min(price_yen)::integer as previous_min_price_yen
    from previous_store_prices
    group by product_id
  ),
  changes as (
    select
      product.id as product_id,
      product.name,
      product.brand,
      product.pack,
      product.image_url,
      current.current_min_price_yen,
      previous.previous_min_price_yen,
      current.current_store_count,
      current.latest_collected_at,
      current.current_min_price_yen - previous.previous_min_price_yen as change_yen,
      case
        when current.current_min_price_yen is null then 'missing'
        when previous.previous_min_price_yen is null then 'new'
        when current.current_min_price_yen < previous.previous_min_price_yen then 'down'
        when current.current_min_price_yen > previous.previous_min_price_yen then 'up'
        else 'same'
      end as change_direction
    from favorite_products favorite
    join public.products product on product.id = favorite.product_id
    left join current_summary current on current.product_id = favorite.product_id
    left join previous_summary previous on previous.product_id = favorite.product_id
  )
  select jsonb_build_object(
    'days', target_days,
    'items', coalesce(jsonb_agg(to_jsonb(change_row) order by change_row.change_yen asc nulls last, change_row.name), '[]'::jsonb)
  ) into result
  from changes change_row;

  return result;
end;
$$;

revoke all on function public.fetch_favorite_price_changes(jsonb) from public;
grant execute on function public.fetch_favorite_price_changes(jsonb) to authenticated;

notify pgrst, 'reload schema';
