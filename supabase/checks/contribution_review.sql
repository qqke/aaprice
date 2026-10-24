-- Synthetic accounts and prices exist only inside this rolled-back transaction; no mail is sent.
begin;
set local statement_timeout = '15s';
do $$
declare
  contributor uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  admin_user uuid;
  product text;
  store text;
  submission public.user_price_logs;
  rejected public.user_price_logs;
  personal uuid;
  task uuid;
  reward integer := greatest(0, public.app_setting_int('approved_contribution_reward', 3));
  changed integer;
begin
  select id into admin_user from public.profiles where role = 'admin' limit 1;
  select id into product from public.products p where not exists (
    select 1 from public.price_tasks t where t.product_id = p.id and t.status in ('open', 'claimed')) limit 1;
  select id into store from public.stores where id not like 'online-%' limit 1;
  if admin_user is null or product is null or store is null then raise exception 'Missing review test prerequisites'; end if;
  insert into auth.users(id, email) values (contributor, contributor::text || '@example.invalid'),
    (other_user, other_user::text || '@example.invalid');
  insert into public.price_tasks(product_id, store_id, status, assigned_user_id, claimed_at)
    values(product, store, 'claimed', contributor, now()) returning id into task;
  perform set_config('request.jwt.claim.sub', contributor::text, true);
  execute 'set local role authenticated';
  insert into public.user_price_logs(user_id, product_id, price_yen)
    values(contributor, product, 123) returning id into personal;
  begin
    insert into public.user_price_logs(user_id, product_id, store_id, price_yen, share_to_public, review_status)
      values(contributor, product, store, 123, true, 'pending');
    raise exception 'Owner forged public submission through table API';
  exception when insufficient_privilege then null;
  end;
  submission := public.submit_store_price(jsonb_build_object('product_id', product, 'store_id', store,
    'price_yen', 123, 'share_to_public', true));
  if submission.review_status <> 'pending' then raise exception 'Contribution must await review'; end if;
  rejected := public.submit_store_price(jsonb_build_object('product_id', product, 'store_id', store,
    'price_yen', 124, 'share_to_public', true));
  begin
    perform public.admin_review_price_submission(jsonb_build_object('id', submission.id, 'action', 'approve'));
    raise exception 'Contributor approved their own submission';
  exception when raise_exception then
    if sqlerrm <> 'admin privileges required' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', other_user::text, true);
  if exists(select 1 from public.user_price_logs where id in (personal, submission.id)) then
    raise exception 'Other user read private contribution records';
  end if;
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  rejected := public.admin_review_price_submission(jsonb_build_object('id', rejected.id, 'action', 'reject'));
  if rejected.promoted_price_id is not null then raise exception 'Rejection published a price'; end if;
  if exists(select 1 from public.credit_ledger where reference_id = rejected.id) then raise exception 'Rejection rewarded credits'; end if;
  if not exists(select 1 from public.price_tasks where id = task and status = 'claimed') then raise exception 'Rejection completed task'; end if;
  begin
    perform public.admin_review_price_submission(jsonb_build_object('id', personal, 'action', 'approve'));
    raise exception 'Private record was approved';
  exception when raise_exception then
    if sqlerrm <> 'price submission is not pending' then raise; end if;
  end;
  submission := public.admin_review_price_submission(jsonb_build_object('id', submission.id, 'action', 'approve'));
  execute 'reset role';
  if submission.review_status <> 'approved' or not exists(select 1 from public.prices
    where id = submission.promoted_price_id and price_yen = 123 and source = 'community') then
    raise exception 'Approval must publish matching price';
  end if;
  if (select coalesce(sum(amount), 0) from public.credit_ledger where reference_id = submission.id) <> reward then
    raise exception 'Approval must grant configured contribution reward';
  end if;
  if not exists(select 1 from public.price_tasks where id = task and status = 'completed' and completed_at is not null) then
    raise exception 'Approval must complete contributor claimed task';
  end if;
  execute 'set local role authenticated';
  begin
    perform public.admin_review_price_submission(jsonb_build_object('id', submission.id, 'action', 'approve'));
    raise exception 'Repeated approval was accepted';
  exception when raise_exception then
    if sqlerrm <> 'price submission is not pending' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', contributor::text, true);
  update public.user_price_logs set review_status = 'pending' where id = submission.id;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Contributor reopened reviewed record'; end if;
  begin
    update public.user_price_logs set share_to_public = true, review_status = 'pending' where id = personal;
    raise exception 'Owner converted private record to review queue directly';
  exception when insufficient_privilege then null;
  end;
  update public.user_price_logs set note = 'Private edit remains supported' where id = personal;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Private edits broken'; end if;
  submission := public.submit_store_price(jsonb_build_object('product_id', product, 'store_id', store,
    'price_yen', 123, 'share_to_public', true));
  if submission.review_status <> 'approved' then raise exception 'Resubmission reopened approved record'; end if;
  execute 'reset role';
  if (select count(*) from public.credit_ledger where reference_id = submission.id) <> (case when reward > 0 then 1 else 0 end) then
    raise exception 'Duplicate reward';
  end if;
  insert into public.price_tasks(product_id, store_id, status, assigned_user_id, claimed_at)
    values(product, store, 'claimed', other_user, now()) returning id into task;
  execute 'set local role authenticated';
  rejected := public.submit_store_price(jsonb_build_object('product_id', product, 'store_id', store,
    'price_yen', 125, 'share_to_public', true));
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform public.admin_review_price_submission(jsonb_build_object('id', rejected.id, 'action', 'approve'));
  execute 'reset role';
  if not exists(select 1 from public.price_tasks where id = task and status = 'claimed' and assigned_user_id = other_user) then
    raise exception 'Approval completed another contributor task';
  end if;
end;
$$;
rollback;
