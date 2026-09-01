select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'sundrug_products', count(*) filter (where catalog_source = 'sundrug'),
  'current_source_products', count(*) filter (where catalog_source = 'sundrug' and last_seen_at >= now() - interval '2 hours'),
  'current_missing_category', count(*) filter (where catalog_source = 'sundrug' and last_seen_at >= now() - interval '2 hours' and nullif(btrim(category), '') is null),
  'current_missing_description', count(*) filter (where catalog_source = 'sundrug' and last_seen_at >= now() - interval '2 hours' and nullif(btrim(description), '') is null),
  'current_missing_image', count(*) filter (where catalog_source = 'sundrug' and last_seen_at >= now() - interval '2 hours' and nullif(btrim(image_url), '') is null),
  'missing_category', count(*) filter (where catalog_source = 'sundrug' and nullif(btrim(category), '') is null),
  'missing_description', count(*) filter (where catalog_source = 'sundrug' and nullif(btrim(description), '') is null),
  'missing_pack', count(*) filter (where catalog_source = 'sundrug' and nullif(btrim(pack), '') is null),
  'numeric_only_pack', count(*) filter (where catalog_source = 'sundrug' and btrim(pack) ~ '^\d+$'),
  'missing_image', count(*) filter (where catalog_source = 'sundrug' and nullif(btrim(image_url), '') is null)
)) as catalog_quality
from public.products;
