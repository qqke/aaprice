-- Synthetic metrics live only inside this rolled-back transaction. No affiliate requests.
begin isolation level repeatable read;
set local statement_timeout = '15s';
do $$
declare
  admin_id uuid;
  first_offer uuid;
  other_offer uuid;
  sessions uuid[] := array(select gen_random_uuid() from generate_series(1, 9));
  before_result jsonb;
  after_result jsonb;
  eligible integer;
  clicks integer;
begin
  select id into admin_id from public.profiles where role = 'admin' limit 1;
  select id into first_offer from public.commercial_offers where is_active limit 1;
  select id into other_offer from public.commercial_offers where is_active and id <> first_offer limit 1;
  if admin_id is null or other_offer is null then raise exception 'Requires an admin and two existing offers'; end if;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  before_result := public.admin_fetch_commercial_validation('{"days":1}');
  if (before_result->>'eligible_sessions')::integer = 0 and before_result->'outbound_click_percent' <> 'null'::jsonb then
    raise exception 'No exposure sample must return null, not a measured zero percent';
  end if;

  insert into public.telemetry_events(session_id, event_name, payload, occurred_at)
  select sessions[item], 'commercial_offer_seen',
    jsonb_build_object('source', source, 'offer_id', first_offer::text, 'measurement', measurement),
    now() + age
  from (values
    (1, 'product', 'viewport_v1', interval '-2 hours'),
    (1, 'product', 'viewport_v1', interval '-2 hours'),
    (2, 'compare', 'viewport_v1', interval '-2 hours'),
    (3, 'product', 'viewport_v1', interval '-2 hours'),
    (4, 'product', 'legacy', interval '-2 hours'),
    (5, 'product', 'viewport_v1', interval '-1 hour'),
    (7, 'product', 'viewport_v1', interval '-2 days'),
    (8, 'compare', 'viewport_v1', interval '-2 hours'),
    (9, 'product', 'viewport_v1', interval '1 hour')
  ) fixture(item, source, measurement, age);

  insert into public.commercial_clicks(session_id, offer_id, source, clicked_at)
  select sessions[item], case when item = 3 then other_offer else first_offer end, source, now() + age
  from (values
    (1, 'product', interval '-1 hour'), (1, 'product', interval '-1 hour'),
    (2, 'product', interval '-1 hour'), (3, 'product', interval '-1 hour'),
    (4, 'product', interval '-1 hour'), (5, 'product', interval '-2 hours'),
    (6, 'product', interval '-1 hour'), (7, 'product', interval '-1 hour'),
    (8, 'compare', interval '-1 hour'), (9, 'product', interval '2 hours')
  ) fixture(item, source, age);

  after_result := public.admin_fetch_commercial_validation('{"days":1}');
  eligible := (before_result->>'eligible_sessions')::integer + 5;
  clicks := (before_result->>'click_sessions')::integer + 2;
  if (after_result->>'eligible_sessions')::integer <> eligible
    or (after_result->>'click_sessions')::integer <> clicks
    or (after_result->>'product_sessions')::integer <> (before_result->>'product_sessions')::integer + 3
    or (after_result->>'compare_sessions')::integer <> (before_result->>'compare_sessions')::integer + 2
    or (after_result->>'product_click_sessions')::integer <> (before_result->>'product_click_sessions')::integer + 1
    or (after_result->>'compare_click_sessions')::integer <> (before_result->>'compare_click_sessions')::integer + 1
    or (after_result->>'outbound_click_percent')::numeric <> round(100.0 * clicks / eligible, 1)
    or after_result->>'measurement' <> 'viewport_v1' then
    raise exception 'Commercial attribution mismatch: % versus baseline %', after_result, before_result;
  end if;
  if (public.admin_fetch_commercial_validation('{"days":"99999999999999999999"}')->>'days')::integer <> 365 then
    raise exception 'Days must remain bounded without integer overflow';
  end if;
  if has_function_privilege('anon', 'public.admin_fetch_commercial_validation(jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.admin_fetch_commercial_validation(jsonb)', 'execute')
    or has_table_privilege('anon', 'public.commercial_clicks', 'select') then
    raise exception 'Commercial metrics must remain admin-only';
  end if;
  perform set_config('request.jwt.claim.sub', sessions[6]::text, true);
  begin
    perform public.admin_fetch_commercial_validation('{}');
    raise exception 'Non-admin unexpectedly read commercial metrics';
  exception when raise_exception then
    if sqlerrm <> 'admin privileges required' then raise; end if;
  end;
  raise notice 'Commercial attribution passed: visible cohorts, source/offer/order/window matching, deduplication, bounds and admin guard';
end;
$$;
rollback;
