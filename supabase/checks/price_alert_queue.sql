-- This transaction never sends mail; all fixture alerts and delivery changes roll back.
begin;
set local statement_timeout = '15s';
create function public.__price_alert_privilege_probe() returns integer language sql as 'select 1';
do $$
declare
  target_user uuid;
  admin_user uuid;
  unconfirmed_user uuid := gen_random_uuid();
  unconfirmed_delivery uuid;
  target_products text[];
  fixture_deliveries uuid[] := '{}';
  alert_id uuid;
  delivery_id uuid;
  claimed jsonb;
  item integer;
  signature text;
begin
  if has_function_privilege('anon', 'public.__price_alert_privilege_probe()', 'execute')
    or has_function_privilege('authenticated', 'public.__price_alert_privilege_probe()', 'execute') then
    raise exception 'New migration functions must require explicit client grants';
  end if;
  select id into target_user from auth.users where email_confirmed_at is not null limit 1;
  select id into admin_user from public.profiles where role = 'admin' limit 1;
  select array_agg(id) into target_products from (
    select product.id from public.products product
    where not exists(select 1 from public.price_alerts a where a.user_id = target_user and a.product_id = product.id)
    order by product.id limit 3
  ) product;
  if target_user is null or array_length(target_products, 1) <> 3 then raise exception 'Requires a confirmed account and three unused products'; end if;
  for item in 1..3 loop
    insert into public.price_alerts(user_id, product_id, target_price_yen, is_active)
    values(target_user, target_products[item], case when item = 2 then 50 else 100 end, item <> 1)
    returning id into alert_id;
    insert into public.notification_deliveries(alert_id, user_id, product_id, channel, price_yen, idempotency_key, created_at)
    values(alert_id, target_user, target_products[item], 'email', 90, 'transaction-test:' || gen_random_uuid()::text, now() - interval '1 year')
    returning id into delivery_id;
    fixture_deliveries := array_append(fixture_deliveries, delivery_id);
  end loop;
  insert into auth.users(id, email) values(unconfirmed_user, unconfirmed_user::text || '@example.invalid');
  insert into public.price_alerts(user_id, product_id, target_price_yen)
  values(unconfirmed_user, target_products[3], 100) returning id into alert_id;
  insert into public.notification_deliveries(alert_id, user_id, product_id, channel, price_yen, idempotency_key, created_at)
  values(alert_id, unconfirmed_user, target_products[3], 'email', 90, 'transaction-test:' || gen_random_uuid()::text, now() - interval '1 year')
  returning id into unconfirmed_delivery;

  execute 'set local role service_role';
  claimed := public.claim_price_alert_deliveries('{"limit":50}');
  if exists(select 1 from jsonb_array_elements(claimed) row where row->>'id' in (fixture_deliveries[1]::text, fixture_deliveries[2]::text))
    or not exists(select 1 from jsonb_array_elements(claimed) row where row->>'id' = fixture_deliveries[3]::text) then
    raise exception 'Inactive and lowered-target alerts must not be claimed; eligible alert must be claimed';
  end if;
  if exists(select 1 from public.notification_deliveries where id = any(fixture_deliveries[1:2]) and attempt_count <> 0) then
    raise exception 'Ineligible deliveries must not consume retries';
  end if;
  if exists(select 1 from jsonb_array_elements(claimed) row where row->>'id' = unconfirmed_delivery::text) then
    raise exception 'Unconfirmed recipient must not be claimed';
  end if;
  claimed := public.claim_price_alert_deliveries('{"limit":50}');
  if exists(select 1 from jsonb_array_elements(claimed) row where row->>'id' = fixture_deliveries[3]::text) then
    raise exception 'Active processing lease must not be reclaimed';
  end if;
  execute 'reset role';

  for signature in select unnest(array['claim_price_alert_deliveries(jsonb)', 'complete_price_alert_delivery(jsonb)', 'enqueue_price_alert_deliveries()', 'refill_price_tasks(jsonb)']) loop
    if has_function_privilege('anon', 'public.' || signature, 'execute')
      or has_function_privilege('authenticated', 'public.' || signature, 'execute')
      or not has_function_privilege('service_role', 'public.' || signature, 'execute') then
      raise exception 'Worker RPC access must be service-only: %', signature;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  begin
    perform public.admin_fetch_telemetry_recent('{}');
    raise exception 'Non-admin unexpectedly read recent telemetry';
  exception when raise_exception then
    if sqlerrm <> 'admin privileges required' then raise; end if;
  end;
  execute 'reset role';
  if admin_user is not null then
    perform set_config('request.jwt.claim.sub', admin_user::text, true);
    execute 'set local role authenticated';
    if jsonb_typeof(public.admin_fetch_telemetry_recent('{"limit":1}')->'items') <> 'array' then
      raise exception 'Administrator recent telemetry contract changed';
    end if;
    execute 'reset role';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname, 6)='admin_' and has_function_privilege('anon',p.oid,'execute')) then
    raise exception 'Admin RPCs must not be executable by anon';
  end if;
end;
$$;
rollback;
