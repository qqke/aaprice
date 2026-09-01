create or replace function public.admin_fetch_price_health(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$'
      then least(180, greatest(1, (payload->>'days')::integer))
    else 30
  end;
  target_limit integer := case
    when coalesce(payload->>'limit', '') ~ '^\d+$'
      then least(100, greatest(1, (payload->>'limit')::integer))
    else 20
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  with latest_store_prices as (
    select distinct on (price.product_id, price.store_id)
      price.product_id,
      price.store_id,
      price.collected_at
    from public.prices price
    where price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
    order by price.product_id, price.store_id, price.collected_at desc
  ),
  product_health as (
    select
      product.id,
      product.name,
      product.barcode,
      count(latest.store_id) filter (
        where latest.collected_at >= now() - make_interval(days => target_days)
      )::integer as fresh_store_count
    from public.products product
    left join latest_store_prices latest on latest.product_id = product.id
    group by product.id, product.name, product.barcode
  ),
  summary as (
    select
      count(*)::integer as total_products,
      count(*) filter (where fresh_store_count > 0)::integer as covered_products,
      coalesce(round(avg(fresh_store_count) filter (where fresh_store_count > 0), 2), 0) as average_fresh_stores
    from product_health
  ),
  price_summary as (
    select
      count(*)::integer as latest_store_prices,
      count(*) filter (
        where collected_at < now() - make_interval(days => target_days)
      )::integer as stale_store_prices
    from latest_store_prices
  ),
  source_health as (
    select
      price.source,
      price.store_id,
      coalesce(store.name, price.store_id) as store_name,
      count(*) filter (
        where price.collected_at >= now() - make_interval(days => target_days)
      )::integer as recent_snapshot_count,
      count(distinct price.product_id) filter (
        where price.collected_at >= now() - make_interval(days => target_days)
      )::integer as recent_product_count,
      max(price.collected_at) as last_collected_at,
      round((extract(epoch from (now() - max(price.collected_at))) / 3600.0)::numeric, 1) as age_hours,
      max(price.collected_at) < now() - interval '8 days' as is_stale
    from public.prices price
    left join public.stores store on store.id = price.store_id
    group by price.source, price.store_id, store.name
  )
  select jsonb_build_object(
    'days', target_days,
    'total_products', summary.total_products,
    'products_with_fresh_price', summary.covered_products,
    'products_without_fresh_price', summary.total_products - summary.covered_products,
    'fresh_coverage_percent', coalesce(round(100.0 * summary.covered_products / nullif(summary.total_products, 0), 1), 0),
    'average_fresh_stores_per_priced_product', summary.average_fresh_stores,
    'latest_store_price_count', price_summary.latest_store_prices,
    'stale_store_price_count', price_summary.stale_store_prices,
    'stale_store_price_percent', coalesce(round(100.0 * price_summary.stale_store_prices / nullif(price_summary.latest_store_prices, 0), 1), 0),
    'price_sources', coalesce((
      select jsonb_agg(to_jsonb(health) order by health.last_collected_at desc, health.source, health.store_id)
      from source_health health
    ), '[]'::jsonb),
    'products_needing_prices', coalesce((
      select jsonb_agg(to_jsonb(needs) order by needs.fresh_store_count, needs.id)
      from (
        select id, name, barcode, fresh_store_count
        from product_health
        where fresh_store_count = 0
        order by id
        limit target_limit
      ) needs
    ), '[]'::jsonb)
  ) into result
  from summary
  cross join price_summary;

  return result;
end;
$$;

revoke all on function public.admin_fetch_price_health(jsonb) from public;
grant execute on function public.admin_fetch_price_health(jsonb) to authenticated;

notify pgrst, 'reload schema';
