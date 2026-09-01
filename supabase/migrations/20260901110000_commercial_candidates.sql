create or replace function public.admin_fetch_commercial_candidates(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_days integer := case
    when coalesce(payload->>'days', '') ~ '^\d+$' then least(365, greatest(1, (payload->>'days')::integer))
    else 90
  end;
  target_limit integer := case
    when coalesce(payload->>'limit', '') ~ '^\d+$' then least(100, greatest(1, (payload->>'limit')::integer))
    else 50
  end;
  result jsonb;
begin
  perform public.require_admin_user();

  with engagement as (
    select
      event.payload->>'product_id' as product_id,
      count(*) filter (where event.event_name = 'product_viewed')::integer as product_views,
      count(*) filter (where event.event_name = 'price_query_succeeded')::integer as price_queries,
      count(*) filter (where event.event_name = 'favorite_revisited')::integer as favorite_revisits,
      count(*) filter (where event.event_name = 'map_opened')::integer as map_opens
    from public.telemetry_events event
    where event.occurred_at >= now() - make_interval(days => target_days)
      and event.payload->>'product_id' <> ''
    group by event.payload->>'product_id'
  ),
  favorite_counts as (
    select favorite.entity_id as product_id, count(*)::integer as favorite_count
    from public.favorites favorite
    where favorite.entity_type = 'product'
    group by favorite.entity_id
  ),
  latest_prices as (
    select distinct on (price.product_id, price.store_id)
      price.product_id, price.store_id, price.price_yen, price.collected_at
    from public.prices price
    where price.price_yen > 0
      and coalesce(price.is_member_price, false) = false
      and price.collected_at >= now() - interval '30 days'
    order by price.product_id, price.store_id, price.collected_at desc
  ),
  current_prices as (
    select
      latest.product_id,
      min(latest.price_yen)::integer as minimum_price_yen,
      count(*)::integer as price_source_count,
      max(latest.collected_at) as latest_price_at
    from latest_prices latest
    group by latest.product_id
  ),
  candidates as (
    select
      product.id as product_id,
      product.name as product_name,
      product.brand,
      product.barcode,
      current.minimum_price_yen,
      current.price_source_count,
      current.latest_price_at,
      coalesce(engagement.product_views, 0) as product_views,
      coalesce(engagement.price_queries, 0) as price_queries,
      coalesce(engagement.favorite_revisits, 0) as favorite_revisits,
      coalesce(engagement.map_opens, 0) as map_opens,
      coalesce(favorite_counts.favorite_count, 0) as favorite_count,
      (coalesce(engagement.product_views, 0) * 3
        + coalesce(engagement.price_queries, 0) * 8
        + coalesce(engagement.favorite_revisits, 0) * 10
        + coalesce(engagement.map_opens, 0) * 5
        + coalesce(favorite_counts.favorite_count, 0) * 10)::integer as interest_score,
      product.last_seen_at
    from public.products product
    left join current_prices current on current.product_id = product.id
    left join engagement on engagement.product_id = product.id
    left join favorite_counts on favorite_counts.product_id = product.id
    where not exists (select 1 from public.commercial_offers offer where offer.product_id = product.id)
      and (
        coalesce(engagement.product_views, 0)
          + coalesce(engagement.price_queries, 0)
          + coalesce(engagement.favorite_revisits, 0)
          + coalesce(engagement.map_opens, 0)
          + coalesce(favorite_counts.favorite_count, 0) > 0
        or (
          current.minimum_price_yen between 100 and 10000
          and concat_ws(' ', product.name, product.category) ~ '(医薬|薬用|化粧|コスメ|スキン|美容|サプリ|ビタミン|目薬|日焼け|シャンプー|リンス|ボディ|ハミガキ|歯磨|洗剤|衛生|マスク)'
        )
      )
    order by interest_score desc, current.latest_price_at desc nulls last, product.last_seen_at desc nulls last, product.id
    limit target_limit
  )
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.interest_score desc, candidate.latest_price_at desc, candidate.product_id), '[]'::jsonb)
  into result
  from candidates candidate;

  return result;
end;
$$;

revoke all on function public.admin_fetch_commercial_candidates(jsonb) from public;
grant execute on function public.admin_fetch_commercial_candidates(jsonb) to authenticated;

notify pgrst, 'reload schema';
