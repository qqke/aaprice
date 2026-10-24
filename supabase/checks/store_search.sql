begin read only;
set local role anon;
set local statement_timeout = '10s';
do $$
declare
  chosen public.stores;
  nearest public.stores;
  first_ids text[];
  next_ids text[];
  unicode_store public.stores;
begin
  if (select prosecdef from pg_proc where oid='public.search_public_stores(jsonb)'::regprocedure) then
    raise exception 'Store search must respect caller RLS';
  end if;
  select * into chosen from public.stores where lat between -90 and 90 and lng between -180 and 180
    and id <> 'sundrug-00000' and coalesce(name,'') !~* 'オンライン|online'
    order by name,id offset 1000 limit 1;
  if chosen.id is null then raise exception 'Requires production-sized store data'; end if;
  select * into unicode_store from public.stores where name <> normalize(name,NFKC) limit 1;
  if unicode_store.id is not null and not exists(select 1 from public.search_public_stores(jsonb_build_object('query',upper(normalize(unicode_store.name,NFKC)),'limit',500)) where id=unicode_store.id) then
    raise exception 'Full-width names must match normalized search';
  end if;
  if not exists(select 1 from public.search_public_stores(jsonb_build_object('query',chosen.name,'limit',500)) where id=chosen.id) then
    raise exception 'Store beyond initial 500 must be searchable';
  end if;
  select * into nearest from public.search_public_stores(jsonb_build_object('lat',chosen.lat,'lng',chosen.lng,'physical_only',true,'limit',1));
  if nearest.id is null or abs(nearest.lat-chosen.lat)>0.000001 or abs(nearest.lng-chosen.lng)>0.000001 then
    raise exception 'Distance sort must search the full catalog';
  end if;
  select array_agg(id) into first_ids from public.search_public_stores('{"limit":30}');
  select array_agg(id) into next_ids from public.search_public_stores('{"limit":30,"offset":30}');
  if cardinality(first_ids)<>30 or cardinality(next_ids)<>30 or first_ids && next_ids then raise exception 'Unstable store pagination'; end if;
  if exists(select 1 from public.search_public_stores(jsonb_build_object('query', '%_"(),', 'limit',500))) then raise exception 'Search punctuation must remain literal'; end if;
  if (select count(*) from public.search_public_stores('{"limit":"999999999999999999999"}'))<>500 then raise exception 'Store limit must be bounded'; end if;
  if exists(select 1 from public.search_public_stores('{"physical_only":true,"limit":500}') where id='sundrug-00000' or name ~* 'オンライン|online') then raise exception 'Physical filter must happen before limit'; end if;
  begin
    perform public.search_public_stores('{"lat":35}');
    raise exception 'Partial coordinates unexpectedly accepted';
  exception when raise_exception then if sqlerrm<>'Invalid store search coordinates' then raise; end if; end;
end;
$$;
rollback;
