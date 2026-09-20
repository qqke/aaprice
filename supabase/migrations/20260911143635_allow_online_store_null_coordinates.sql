begin;

-- Online shops have no physical location. Keep coordinates mandatory for branches.
alter table public.stores
  alter column lat drop not null,
  alter column lng drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stores'::regclass
      and conname = 'stores_location_required_for_physical'
  ) then
    alter table public.stores add constraint stores_location_required_for_physical
    check (
      (lat is not null and lng is not null)
      or (lat is null and lng is null and (name ~* '(オンライン|online)' or id = 'sundrug-00000'))
    );
  end if;
end $$;

commit;
