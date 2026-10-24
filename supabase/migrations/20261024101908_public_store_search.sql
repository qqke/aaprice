create or replace function public.search_public_stores(payload jsonb default '{}'::jsonb)
returns setof public.stores
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  needle text := lower(normalize(btrim(coalesce(payload->>'query', '')), NFKC));
  target_limit integer := case when coalesce(payload->>'limit', '') ~ '^\d+$'
    then least(500, greatest(1, (payload->>'limit')::numeric))::integer else 100 end;
  target_offset integer := case when coalesce(payload->>'offset', '') ~ '^\d+$'
    then least(1000000, (payload->>'offset')::numeric)::integer else 0 end;
  target_lat double precision;
  target_lng double precision;
  physical_only boolean := coalesce((payload->>'physical_only')::boolean, false);
begin
  if length(needle) > 200 then raise exception 'Store search supports at most 200 characters'; end if;
  if payload ? 'lat' or payload ? 'lng' then
    if jsonb_typeof(payload->'lat') is distinct from 'number' or jsonb_typeof(payload->'lng') is distinct from 'number'
      or not ((payload->>'lat')::numeric between -90 and 90 and (payload->>'lng')::numeric between -180 and 180) then
      raise exception 'Invalid store search coordinates';
    end if;
    target_lat := (payload->>'lat')::double precision;
    target_lng := (payload->>'lng')::double precision;
  end if;
  return query
  select store.* from public.stores store
  where (not physical_only or (store.id <> 'sundrug-00000' and coalesce(store.name, '') !~* 'オンライン|online'))
    and (needle = ''
      or strpos(lower(normalize(concat_ws(' ', store.name, store.chain_name, store.pref, store.city, store.address), NFKC)), needle) > 0
      or (needle in ('スギ薬局', 'スギドラッグ', 'すぎ薬局') and concat_ws(' ', store.name, store.chain_name) ~ 'スギ薬局|スギドラッグ|ドラッグスギ'))
  order by case when target_lat is not null and target_lng is not null
    and store.lat between -90 and 90 and store.lng between -180 and 180
    then 6371 * acos(least(1.0, greatest(-1.0,
      cos(radians(target_lat)) * cos(radians(store.lat)) * cos(radians(store.lng) - radians(target_lng))
      + sin(radians(target_lat)) * sin(radians(store.lat))))) end asc nulls last,
    store.name asc, store.id asc
  limit target_limit offset target_offset;
end;
$$;
revoke all on function public.search_public_stores(jsonb) from public;
grant execute on function public.search_public_stores(jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
