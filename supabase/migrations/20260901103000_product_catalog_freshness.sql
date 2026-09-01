alter table public.products
  add column if not exists catalog_source text not null default '',
  add column if not exists last_seen_at timestamptz;

update public.products as product
set
  catalog_source = 'sundrug',
  last_seen_at = observed.last_seen_at
from (
  select price.product_id, max(price.collected_at) as last_seen_at
  from public.prices price
  where price.store_id = 'sundrug-00000'
  group by price.product_id
) observed
where product.id = observed.product_id
  and (product.catalog_source, product.last_seen_at) is distinct from ('sundrug', observed.last_seen_at);

create index if not exists products_catalog_freshness_idx
  on public.products (last_seen_at desc nulls last, updated_at desc);

notify pgrst, 'reload schema';
