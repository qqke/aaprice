create table if not exists public.product_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barcode text not null,
  name text not null,
  brand text not null default '',
  pack text not null default '',
  category text not null default '',
  tone text not null default 'sunset',
  description text not null default '',
  image_url text not null default '',
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  promoted_product_id text references public.products(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_submissions_image_url_check
    check (image_url = '' or image_url ~* '^https?://')
);

create index if not exists product_submissions_review_idx
  on public.product_submissions (review_status, created_at desc);
create index if not exists product_submissions_user_idx
  on public.product_submissions (user_id, created_at desc);

alter table public.product_submissions enable row level security;

drop policy if exists "products authenticated insert" on public.products;
drop policy if exists "product submissions owner read" on public.product_submissions;
create policy "product submissions owner read" on public.product_submissions
  for select using (auth.uid() = user_id);
drop policy if exists "product submissions owner insert" on public.product_submissions;
create policy "product submissions owner insert" on public.product_submissions
  for insert with check (auth.uid() = user_id);
drop policy if exists "product submissions admin read" on public.product_submissions;
create policy "product submissions admin read" on public.product_submissions
  for select using (public.is_admin_user());
drop policy if exists "product submissions admin update" on public.product_submissions;
create policy "product submissions admin update" on public.product_submissions
  for update using (public.is_admin_user()) with check (public.is_admin_user());

drop trigger if exists product_submissions_updated_at on public.product_submissions;
create trigger product_submissions_updated_at
before update on public.product_submissions
for each row execute function public.set_updated_at();

create or replace function public.submit_product_submission(payload jsonb)
returns public.product_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.product_submissions;
  target_barcode text;
begin
  perform public.require_authenticated_user();
  target_barcode := regexp_replace(coalesce(payload->>'barcode', payload->>'id', ''), '\D', '', 'g');

  if target_barcode !~ '^(\d{8}|\d{12,14})$' then
    raise exception 'jan_code is required';
  end if;
  if coalesce(payload->>'name', '') = '' then
    raise exception 'name is required';
  end if;
  if exists (
    select 1 from public.products
    where barcode = target_barcode
       or id = coalesce(nullif(payload->>'id', ''), target_barcode)
  ) then
    raise exception 'product already exists';
  end if;

  insert into public.product_submissions (
    user_id, barcode, name, brand, pack, category, tone, description, image_url
  ) values (
    auth.uid(),
    target_barcode,
    coalesce(payload->>'name', ''),
    coalesce(payload->>'brand', ''),
    coalesce(payload->>'pack', ''),
    coalesce(payload->>'category', ''),
    coalesce(nullif(payload->>'tone', ''), 'sunset'),
    coalesce(payload->>'description', ''),
    case when coalesce(payload->>'image_url', '') ~* '^https?://' then payload->>'image_url' else '' end
  ) returning * into result;

  return result;
end;
$$;

create or replace function public.admin_review_product_submission(payload jsonb)
returns public.product_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  target_submission public.product_submissions;
  result public.product_submissions;
  action text;
  next_product_id text;
begin
  perform public.require_admin_user();
  action := coalesce(payload->>'action', '');
  if action not in ('approve', 'reject') then
    raise exception 'review action must be approve or reject';
  end if;

  select * into target_submission
  from public.product_submissions
  where id = nullif(payload->>'id', '')::uuid
  for update;

  if not found then
    raise exception 'product submission not found';
  end if;
  if target_submission.review_status <> 'pending' then
    raise exception 'product submission is not pending';
  end if;

  if action = 'approve' then
    next_product_id := coalesce(nullif(payload->>'product_id', ''), target_submission.barcode);
    insert into public.products (
      id, barcode, name, brand, pack, category, tone, description, image_url
    ) values (
      next_product_id,
      target_submission.barcode,
      target_submission.name,
      target_submission.brand,
      target_submission.pack,
      target_submission.category,
      target_submission.tone,
      target_submission.description,
      target_submission.image_url
    )
    on conflict (id) do update set
      barcode = excluded.barcode,
      name = excluded.name,
      brand = excluded.brand,
      pack = excluded.pack,
      category = excluded.category,
      tone = excluded.tone,
      description = excluded.description,
      image_url = excluded.image_url,
      updated_at = now();

    update public.product_submissions set
      review_status = 'approved',
      review_note = coalesce(payload->>'review_note', ''),
      promoted_product_id = next_product_id,
      reviewed_at = now()
    where id = target_submission.id
    returning * into result;
  else
    update public.product_submissions set
      review_status = 'rejected',
      review_note = coalesce(payload->>'review_note', ''),
      reviewed_at = now()
    where id = target_submission.id
    returning * into result;
  end if;

  return result;
end;
$$;

notify pgrst, 'reload schema';
