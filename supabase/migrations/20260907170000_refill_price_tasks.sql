create unique index if not exists price_tasks_active_product_idx
  on public.price_tasks (product_id)
  where status in ('open', 'claimed');

create or replace function public.refill_price_tasks(payload jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_limit integer := case
    when coalesce(payload, '{}'::jsonb) ? 'limit'
      then least(500, greatest(1, (payload->>'limit')::integer))
    else 100
  end;
  inserted_count integer;
begin
  with candidates as (
    select
      product.id,
      count(price.id) filter (
        where coalesce(price.is_member_price, false) = false
          and price.collected_at >= now() - interval '30 days'
      ) as fresh_price_count,
      max(price.collected_at) filter (
        where coalesce(price.is_member_price, false) = false
      ) as latest_price_at
    from public.products product
    left join public.prices price on price.product_id = product.id
    where coalesce(product.last_seen_at, product.updated_at, product.created_at) >= now() - interval '180 days'
      and not exists (
        select 1
        from public.price_tasks active_task
        where active_task.product_id = product.id
          and active_task.status in ('open', 'claimed')
      )
      and not exists (
        select 1
        from public.price_tasks recent_task
        where recent_task.product_id = product.id
          and recent_task.created_at >= now() - interval '30 days'
      )
    group by product.id, product.last_seen_at
    order by fresh_price_count asc, latest_price_at asc nulls first, product.last_seen_at desc nulls last
    limit target_limit
  ), inserted as (
    insert into public.price_tasks (product_id, status, source, priority, note)
    select
      candidate.id,
      'open',
      'catalog_gap',
      greatest(0, 100 - least(candidate.fresh_price_count, 10)::integer * 10),
      '补充近期非会员门店价格'
    from candidates candidate
    on conflict (product_id) where status in ('open', 'claimed') do nothing
    returning 1
  )
  select count(*)::integer into inserted_count from inserted;

  return inserted_count;
end;
$$;

create or replace function public.claim_random_price_task(payload jsonb default '{}'::jsonb)
returns public.price_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.price_tasks;
  claim_limit integer := greatest(0, public.app_setting_int('task_claim_limit_per_day', 3));
  expiry_hours integer := greatest(1, public.app_setting_int('task_expiry_hours', 24));
  claims_today integer;
begin
  perform public.require_authenticated_user();

  update public.price_tasks
  set status = 'expired', updated_at = now()
  where status = 'claimed'
    and expires_at is not null
    and expires_at < now();

  select count(*)::integer into claims_today
  from public.price_tasks
  where assigned_user_id = auth.uid()
    and claimed_at::date = current_date;

  if claims_today >= claim_limit then
    raise exception 'daily_task_claim_limit_reached';
  end if;

  select * into result
  from public.price_tasks
  where status = 'claimed'
    and assigned_user_id = auth.uid()
    and (expires_at is null or expires_at >= now())
  order by claimed_at desc
  limit 1;

  if found then
    return result;
  end if;

  if not exists (select 1 from public.price_tasks where status = 'open') then
    perform public.refill_price_tasks(jsonb_build_object('limit', 100));
  end if;

  update public.price_tasks
  set status = 'claimed',
      assigned_user_id = auth.uid(),
      claimed_at = now(),
      expires_at = now() + make_interval(hours => expiry_hours),
      updated_at = now()
  where id = (
    select id
    from public.price_tasks
    where status = 'open'
    order by priority desc, random()
    limit 1
    for update skip locked
  )
  returning * into result;

  if not found then
    raise exception 'no_price_tasks_available';
  end if;

  return result;
end;
$$;

revoke all on function public.refill_price_tasks(jsonb) from public;
revoke all on function public.refill_price_tasks(jsonb) from anon, authenticated;
grant execute on function public.refill_price_tasks(jsonb) to service_role;

revoke all on function public.claim_random_price_task(jsonb) from public;
grant execute on function public.claim_random_price_task(jsonb) to authenticated;

notify pgrst, 'reload schema';
