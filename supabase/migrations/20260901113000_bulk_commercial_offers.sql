create unique index if not exists commercial_offers_product_partner_idx
  on public.commercial_offers (product_id, partner);

create or replace function public.admin_bulk_upsert_commercial_offers(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_partner text := lower(trim(coalesce(payload->>'partner', '')));
  target_campaign text := left(trim(coalesce(payload->>'campaign', '')), 100);
  target_active boolean := coalesce((payload->>'is_active')::boolean, false);
  target_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  affected_count integer;
begin
  perform public.require_admin_user();

  if target_partner !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'invalid commercial partner';
  end if;
  if jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'commercial items must contain 1 to 100 rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(target_items) item
    where trim(coalesce(item->>'product_id', '')) = ''
      or trim(coalesce(item->>'destination_url', '')) !~* '^https://'
  ) then
    raise exception 'invalid commercial item';
  end if;
  if (
    select count(*) <> count(distinct trim(item->>'product_id'))
    from jsonb_array_elements(target_items) item
  ) then
    raise exception 'duplicate commercial product';
  end if;

  insert into public.commercial_offers (
    product_id, partner, campaign, destination_url, is_active
  )
  select
    trim(item->>'product_id'),
    target_partner,
    target_campaign,
    trim(item->>'destination_url'),
    target_active
  from jsonb_array_elements(target_items) item
  on conflict (product_id, partner) do update set
    campaign = excluded.campaign,
    destination_url = excluded.destination_url,
    is_active = excluded.is_active;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.admin_bulk_upsert_commercial_offers(jsonb) from public;
grant execute on function public.admin_bulk_upsert_commercial_offers(jsonb) to authenticated;

notify pgrst, 'reload schema';
