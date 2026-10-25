-- All synthetic users, products, review tasks and private prices roll back; no mail is sent.
begin;
set local statement_timeout = '15s';
do $$
declare
  user_id uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  admin_id uuid;
  barcode text := '299' || lpad((floor(random() * 10000000000)::bigint)::text, 10, '0');
  product public.products;
  again public.products;
  submission_id uuid;
  private_id uuid;
begin
  select id into admin_id from public.profiles where role = 'admin' limit 1;
  if admin_id is null then raise exception 'Requires an admin for review verification'; end if;
  if has_function_privilege('anon', 'public.register_scanned_product(jsonb)', 'execute') then raise exception 'Anonymous registration enabled'; end if;
  insert into auth.users(id, email) values(user_id, user_id::text || '@example.invalid'), (second_user, second_user::text || '@example.invalid');
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  execute 'set local role authenticated';
  begin
    perform public.register_scanned_product('{"barcode":"invalid"}');
    raise exception 'Invalid barcode accepted';
  exception when raise_exception then if sqlerrm <> 'valid barcode required' then raise; end if; end;
  product := public.register_scanned_product(jsonb_build_object('barcode', barcode, 'name', 'forged metadata'));
  if not product.needs_details or product.name not like '待完善商品%' or product.brand <> '' then raise exception 'Stub metadata is not explicit'; end if;
  again := public.register_scanned_product(jsonb_build_object('barcode', barcode));
  if again.id <> product.id then raise exception 'Duplicate scan created another product'; end if;
  insert into public.user_price_logs(user_id, product_id, price_yen) values(user_id, product.id, 321) returning id into private_id;
  insert into public.product_submissions(user_id, barcode, name)
    select user_id, '297' || lpad(i::text, 10, '0'), 'Synthetic pending item' from generate_series(1, 99) g(i);
  begin
    perform public.register_scanned_product(jsonb_build_object('barcode', '298' || substr(barcode, 4)));
    raise exception 'Daily new-product registration limit was bypassed';
  exception when raise_exception then if sqlerrm <> 'daily product registration limit reached' then raise; end if; end;
  begin
    insert into public.products(id, barcode, name) values(barcode || 'x', barcode || 'x', 'forged');
    raise exception 'Direct public product insertion enabled';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_complete_scanned_product(jsonb_build_object('id', product.id, 'barcode', barcode, 'name', 'Unauthorized edit'));
    raise exception 'Non-admin completed product metadata';
  exception when raise_exception then if sqlerrm <> 'admin privileges required' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', second_user::text, true);
  again := public.register_scanned_product(jsonb_build_object('barcode', barcode));
  if again.id <> product.id then raise exception 'Another user duplicated barcode'; end if;
  execute 'reset role';
  if (select count(*) from public.product_submissions s where s.barcode = product.barcode and s.review_status = 'pending') <> 1 then raise exception 'Duplicate administrator reminders'; end if;
  select id into submission_id from public.product_submissions where promoted_product_id = product.id and review_status = 'pending';
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  execute 'set local role authenticated';
  begin
    perform public.admin_review_product_submission(jsonb_build_object('id', submission_id, 'action', 'approve'));
    raise exception 'Unfilled placeholder was approved';
  exception when raise_exception then if sqlerrm <> 'complete product details before approval' then raise; end if; end;
  begin
    perform public.admin_complete_scanned_product(to_jsonb(product));
    raise exception 'Placeholder name was accepted as completed';
  exception when raise_exception then if sqlerrm <> 'real product name required' then raise; end if; end;
  again := public.admin_complete_scanned_product(jsonb_build_object('id', product.id, 'barcode', barcode, 'name', 'Reviewed fixture product', 'brand', 'Fixture'));
  if again.needs_details or again.name <> 'Reviewed fixture product' then raise exception 'Completion failed'; end if;
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  again := public.register_scanned_product(jsonb_build_object('barcode', barcode));
  if again.name <> 'Reviewed fixture product' or again.needs_details then raise exception 'Scan overwrote reviewed metadata'; end if;
  execute 'reset role';
  if not exists(select 1 from public.user_price_logs where id = private_id and product_id = product.id and price_yen = 321) then raise exception 'Metadata completion lost personal price'; end if;
  if not exists(select 1 from public.product_submissions where id = submission_id and review_status = 'approved') then raise exception 'Admin reminder was not completed'; end if;
end;
$$;
rollback;
