create or replace function public.admin_fetch_commercial_offers(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_query text := left(trim(coalesce(payload->>'query', '')), 100);
  result jsonb;
begin
  perform public.require_admin_user();

  select coalesce(jsonb_agg(to_jsonb(offer) order by offer.updated_at desc), '[]'::jsonb)
  into result
  from (
    select
      commercial.id,
      commercial.product_id,
      product.name as product_name,
      commercial.store_id,
      store.name as store_name,
      commercial.partner,
      commercial.campaign,
      commercial.destination_url,
      commercial.is_active,
      commercial.created_at,
      commercial.updated_at,
      (select count(*) from public.commercial_clicks click where click.offer_id = commercial.id) as click_count
    from public.commercial_offers commercial
    join public.products product on product.id = commercial.product_id
    left join public.stores store on store.id = commercial.store_id
    where target_query = ''
      or product.name ilike '%' || target_query || '%'
      or commercial.partner ilike '%' || target_query || '%'
      or commercial.campaign ilike '%' || target_query || '%'
    order by commercial.updated_at desc
    limit 500
  ) offer;

  return result;
end;
$$;

create or replace function public.admin_upsert_commercial_offer(payload jsonb)
returns public.commercial_offers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid := case
    when coalesce(payload->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (payload->>'id')::uuid
    else gen_random_uuid()
  end;
  target_partner text := lower(trim(coalesce(payload->>'partner', '')));
  target_url text := trim(coalesce(payload->>'destination_url', ''));
  result public.commercial_offers;
begin
  perform public.require_admin_user();

  if coalesce(payload->>'product_id', '') = '' then
    raise exception 'product_id is required';
  end if;
  if target_partner !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'invalid commercial partner';
  end if;
  if target_url !~* '^https://' then
    raise exception 'commercial destination must use https';
  end if;

  insert into public.commercial_offers (
    id, product_id, store_id, partner, campaign, destination_url, is_active
  ) values (
    target_id,
    payload->>'product_id',
    nullif(payload->>'store_id', ''),
    target_partner,
    left(coalesce(payload->>'campaign', ''), 100),
    target_url,
    coalesce((payload->>'is_active')::boolean, false)
  )
  on conflict (id) do update set
    product_id = excluded.product_id,
    store_id = excluded.store_id,
    partner = excluded.partner,
    campaign = excluded.campaign,
    destination_url = excluded.destination_url,
    is_active = excluded.is_active
  returning * into result;

  return result;
end;
$$;

revoke all on function public.admin_fetch_commercial_offers(jsonb) from public;
revoke all on function public.admin_upsert_commercial_offer(jsonb) from public;
grant execute on function public.admin_fetch_commercial_offers(jsonb) to authenticated;
grant execute on function public.admin_upsert_commercial_offer(jsonb) to authenticated;

notify pgrst, 'reload schema';
