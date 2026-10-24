-- Cover the public discovery scan without visiting every historical price row.
create index if not exists prices_public_discovery_idx
  on public.prices (collected_at desc, product_id)
  where price_yen > 0 and coalesce(is_member_price, false) = false;
