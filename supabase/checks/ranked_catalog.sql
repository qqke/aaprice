-- Read-only acceptance checks against real catalog data; no synthetic prices or events.
begin read only;
set local role anon;
set local statement_timeout = '8s';

do $$
declare
  first_page text[];
  second_page text[];
  available integer;
begin
  select array_agg(id) into first_page
    from public.fetch_public_ranked_products('{"limit":30}');
  select array_agg(id) into second_page
    from public.fetch_public_ranked_products('{"limit":30,"offset":30}');
  if first_page && second_page then
    raise exception 'Discovery pagination repeats products';
  end if;
  if cardinality(first_page) > 30 or cardinality(second_page) > 30 then
    raise exception 'Discovery ignored its page limit';
  end if;
  select count(*) into available from public.fetch_public_catalog_price_previews(
    jsonb_build_object('product_ids', coalesce(first_page, array[]::text[]))
  );
  if available = 0 or available <> cardinality(first_page) then
    raise exception 'Discovery did not prioritize recent public prices';
  end if;
end;
$$;

rollback;
