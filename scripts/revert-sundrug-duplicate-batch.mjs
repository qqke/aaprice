import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {databaseProcess} from './sync-sundrug.mjs'

// Revert only this task's mistaken new-ID batch. Never delete pre-existing records or linked observations.
const out='artifacts/drugstores-import-sundrug-2026-09-13'
const report=JSON.parse(await readFile(`${out}/import-report.json`,'utf8'))
assert(report.applied&&!report.revertedAt,'Batch was not applied or has already been reverted')
const rows=JSON.parse(await readFile(`${out}/stores.json`,'utf8'))
const before=JSON.parse(await readFile(`${out}/database-before.json`,'utf8'))
const priorIds=new Set(before.map(s=>s.id))
assert(rows.every(s=>!priorIds.has(s.id)),'Batch contains pre-existing IDs; automatic rollback forbidden')
const hex=Buffer.from(JSON.stringify(rows)).toString('hex')
const sql=`\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtext('aaprice-drugstore-import'));
lock table public.stores, public.prices, public.user_price_logs, public.price_tasks, public.commercial_offers in share row exclusive mode;
create temp table revert_batch as select * from jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) as x(id text,name text,chain_name text,address text,lat double precision,lng double precision,hours text);
do $$ begin
  if (select count(*) from public.stores s join revert_batch e using(id) where (s.name,s.chain_name,s.address,s.lat,s.lng,s.hours) is not distinct from (e.name,e.chain_name,e.address,e.lat,e.lng,e.hours)) <> ${rows.length} then raise exception 'Batch rows missing or modified; abort rollback'; end if;
  if exists(select 1 from public.prices join revert_batch on store_id=revert_batch.id)
    or exists(select 1 from public.user_price_logs join revert_batch on store_id=revert_batch.id)
    or exists(select 1 from public.price_tasks join revert_batch on store_id=revert_batch.id)
    or exists(select 1 from public.commercial_offers join revert_batch on store_id=revert_batch.id)
  then raise exception 'Batch has linked user data; abort rollback'; end if;
end $$;
delete from public.stores where id in(select id from revert_batch);
commit;
\\pset tuples_only on
\\pset format unaligned
select json_build_object('remainingBatchRows',(select count(*) from public.stores where id in(select id from revert_batch)),'databaseTotal',(select count(*) from public.stores));`
await writeFile(`${out}/guarded-revert.sql`,sql)
const raw=databaseProcess(process.env.AAPRICE_DB_URL,sql)
const result=JSON.parse(raw.slice(raw.lastIndexOf('{')))
assert.equal(result.remainingBatchRows,0)
report.revertedAt=new Date().toISOString();report.revertReason='Alternate Sundrug source IDs and brand affixes caused duplicate identity detection to miss existing stores'
await writeFile(`${out}/import-report.json`,JSON.stringify(report,null,2))
await writeFile(`${out}/revert-report.json`,JSON.stringify({...result,revertedRows:rows.length,revertedAt:report.revertedAt},null,2))
console.log(JSON.stringify({...result,revertedRows:rows.length}))
