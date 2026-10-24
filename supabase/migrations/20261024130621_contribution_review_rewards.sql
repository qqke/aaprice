-- Personal notes cannot create or reopen public review records through the table API.
alter policy "logs owner insert" on public.user_price_logs to authenticated
  with check (auth.uid() = user_id and not share_to_public and review_status = 'private'
    and reviewed_at is null and promoted_price_id is null and confidence_score = 0 and review_note = '');
alter policy "logs owner update" on public.user_price_logs to authenticated
  using (auth.uid() = user_id and not share_to_public and review_status = 'private')
  with check (auth.uid() = user_id and not share_to_public and review_status = 'private'
    and reviewed_at is null and promoted_price_id is null and confidence_score = 0 and review_note = '');

create or replace function public.admin_review_price_submission(payload jsonb)
returns public.user_price_logs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  target_log public.user_price_logs;
  result public.user_price_logs;
  action text := coalesce(payload->>'action', '');
  next_confidence numeric;
  next_price_id uuid;
  reward integer;
begin
  perform public.require_admin_user();
  if action not in ('approve', 'reject') then
    raise exception 'review action must be approve or reject';
  end if;
  select * into target_log from public.user_price_logs
    where id = nullif(payload->>'id', '')::uuid for update;
  if not found then raise exception 'price submission not found'; end if;
  if target_log.review_status <> 'pending' or not target_log.share_to_public then
    raise exception 'price submission is not pending';
  end if;
  next_confidence := greatest(0, least(100, coalesce(nullif(payload->>'confidence_score', '')::numeric, target_log.confidence_score, 0)));
  if action = 'approve' then
    next_price_id := gen_random_uuid();
    insert into public.prices (id, product_id, store_id, price_yen, is_member_price, source, note, collected_at)
    values (next_price_id, target_log.product_id, target_log.store_id, target_log.price_yen, false,
      'community', target_log.note, coalesce(target_log.purchased_at::timestamptz, target_log.created_at));
    reward := greatest(0, public.app_setting_int('approved_contribution_reward', 3));
    if reward > 0 then
      insert into public.credit_ledger (user_id, amount, reason, reference_type, reference_id, note, created_by)
      values (target_log.user_id, reward, 'contribution_reward', 'user_price_logs', target_log.id,
        'Approved community price contribution', auth.uid())
      on conflict (user_id, reference_id) where reason = 'contribution_reward' and reference_id is not null do nothing;
    end if;
    update public.price_tasks set status = 'completed', completed_at = now(), updated_at = now()
    where product_id = target_log.product_id and (store_id = target_log.store_id or store_id is null)
      and status = 'claimed' and assigned_user_id = target_log.user_id;
  end if;
  update public.user_price_logs
  set review_status = case when action = 'approve' then 'approved' else 'rejected' end,
      confidence_score = next_confidence, review_note = coalesce(payload->>'review_note', ''),
      reviewed_at = now(), promoted_price_id = next_price_id, updated_at = now()
  where id = target_log.id returning * into result;
  return result;
end;
$$;
revoke execute on function public.admin_review_price_submission(jsonb) from public, anon;
grant execute on function public.admin_review_price_submission(jsonb) to authenticated;
