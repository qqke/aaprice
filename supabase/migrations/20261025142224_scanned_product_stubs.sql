alter table public.products add column if not exists needs_details boolean not null default false;

-- New scanner records may only be created through the authenticated, bounded RPC.
drop policy if exists "products public insert" on public.products;
revoke insert on public.products from anon, authenticated;
alter policy "product submissions owner insert" on public.product_submissions to authenticated
  with check (auth.uid() = user_id and review_status = 'pending'
    and promoted_product_id is null and reviewed_at is null and review_note = '');

create or replace function public.register_scanned_product(payload jsonb)
returns public.products
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  barcode_value text := coalesce(payload->>'barcode', '');
  result public.products;
  pending_id uuid;
begin
  perform public.require_authenticated_user();
  if barcode_value !~ '^([0-9]{8}|[0-9]{12,14})$' then raise exception 'valid barcode required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('scanned-user:' || auth.uid()::text, 0));
  -- Serialize matching scans, including the first insert, without overwriting real metadata.
  perform pg_advisory_xact_lock(hashtextextended('scanned-product:' || barcode_value, 0));
  select * into result from public.products where barcode = barcode_value for update;
  if not found then
    if (select count(*) from public.product_submissions where user_id = auth.uid() and created_at >= now() - interval '1 day') >= 100 then
      raise exception 'daily product registration limit reached';
    end if;
    insert into public.products(id, barcode, name, catalog_source, needs_details)
    values(barcode_value, barcode_value, '待完善商品 · JAN ' || barcode_value, 'scan_stub', true)
    returning * into result;
  end if;
  if result.needs_details then
    select id into pending_id from public.product_submissions
      where barcode = barcode_value and review_status = 'pending' order by created_at limit 1 for update;
    if pending_id is null then
      insert into public.product_submissions(user_id, barcode, name, promoted_product_id)
      values(auth.uid(), barcode_value, result.name, result.id);
    else
      update public.product_submissions set promoted_product_id = result.id where id = pending_id;
    end if;
  end if;
  return result;
end;
$$;
revoke execute on function public.register_scanned_product(jsonb) from public, anon;
grant execute on function public.register_scanned_product(jsonb) to authenticated;

create or replace function public.admin_complete_scanned_product(payload jsonb)
returns public.products
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  result public.products;
begin
  perform public.require_admin_user();
  select * into result from public.products where id = payload->>'id' for update;
  if not found or not result.needs_details then raise exception 'pending scanned product not found'; end if;
  if btrim(coalesce(payload->>'name', '')) = '' or payload->>'name' like '待完善商品%' then
    raise exception 'real product name required';
  end if;
  if payload->>'barcode' is distinct from result.barcode then raise exception 'scanned barcode cannot change'; end if;
  result := public.admin_upsert_product(payload);
  update public.products set needs_details = false where id = result.id returning * into result;
  update public.product_submissions set review_status = 'approved', reviewed_at = now(),
    review_note = '商品资料已由管理员完善'
    where promoted_product_id = result.id and review_status = 'pending';
  return result;
end;
$$;
revoke execute on function public.admin_complete_scanned_product(jsonb) from public, anon;
grant execute on function public.admin_complete_scanned_product(jsonb) to authenticated;

create or replace function public.guard_scanned_product_review()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.review_status = 'approved' and exists(
    select 1 from public.products where id = new.promoted_product_id and needs_details
  ) then raise exception 'complete product details before approval'; end if;
  return new;
end;
$$;
revoke execute on function public.guard_scanned_product_review() from public, anon, authenticated;
create trigger guard_scanned_product_review before update on public.product_submissions
for each row execute function public.guard_scanned_product_review();
notify pgrst, 'reload schema';
