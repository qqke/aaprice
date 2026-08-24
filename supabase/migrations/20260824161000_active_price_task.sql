create or replace function public.get_active_price_task()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    select jsonb_build_object(
      'id', task.id,
      'product_id', task.product_id,
      'store_id', task.store_id,
      'status', task.status,
      'claimed_at', task.claimed_at,
      'expires_at', task.expires_at
    )
    from public.price_tasks task
    where auth.uid() is not null
      and task.assigned_user_id = auth.uid()
      and task.completed_at is null
      and task.skipped_at is null
      and (task.expires_at is null or task.expires_at > now())
    order by task.claimed_at desc nulls last, task.created_at desc
    limit 1
  );
$$;

revoke all on function public.get_active_price_task() from public;
grant execute on function public.get_active_price_task() to authenticated;

notify pgrst, 'reload schema';
