import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {canonicalStoreIdentity} from './drugstore-identity.mjs'
import {validateStore} from './crawl-national-stores.mjs'
import {databaseProcess} from './sync-sundrug.mjs'

export function planHoursRefresh(existing,observations,now=Date.now()) {
  const byId=new Map(existing.map(s=>[s.id,s])),latest=new Map(),changes=[]
  for(const s of observations) {
    validateStore(s)
    const time=Date.parse(s.collectedAt)
    assert(Number.isFinite(time)&&time<=now&&now-time<=86400000,'Observation must be from the last 24 hours')
    assert(/^https?:\/\//.test(s.sourceUrl),'Missing source URL')
    const old=latest.get(s.id)
    if(old&&old.collectedAt===s.collectedAt)assert.equal(old.hours,s.hours,'Conflicting hours in the same observation')
    if(!old||Date.parse(old.collectedAt)<time)latest.set(s.id,s)
  }
  for(const s of latest.values()) {
    const prior=byId.get(s.id)
    if(!prior||canonicalStoreIdentity(prior)!==canonicalStoreIdentity(s)||!s.hours?.trim()||!/\d|休業/.test(s.hours)||prior.hours===s.hours)continue
    changes.push({id:prior.id,name:prior.name,chain_name:prior.chain_name,address:prior.address,hours:s.hours,
      expectedHoursHash:createHash('md5').update(prior.hours||'').digest('hex'),sourceUrl:s.sourceUrl,collectedAt:s.collectedAt})
  }
  return changes
}

async function main() {
  const args=process.argv.slice(2),out=args.find(x=>x.startsWith('--out='))?.slice(6)
  assert(out,'Pass --out=DIR and current verified stores.json files')
  const files=args.filter(x=>!x.startsWith('--'));assert(files.length,'No source files')
  await mkdir(out,{recursive:true})
  const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from(select id,name,chain_name,address,hours from public.stores)s;")
  const existing=JSON.parse(raw.slice(raw.indexOf('['))),observations=[]
  for(const file of files)observations.push(...JSON.parse(await readFile(file,'utf8')))
  const changes=planHoursRefresh(existing,observations)
  await writeFile(out+'/changes.json',JSON.stringify(changes,null,2))
  const hex=Buffer.from(JSON.stringify(changes)).toString('hex')
  const sql=`\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtext('aaprice-drugstore-import'));
create temp table hours_refresh as select * from jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb)
as x(id text,name text,chain_name text,address text,hours text,"expectedHoursHash" text);
do $$ begin
  perform s.id from public.stores s join hours_refresh e using(id) for update of s;
  if (select count(*) from public.stores s join hours_refresh e using(id)
      where (s.name,s.chain_name,s.address) is not distinct from (e.name,e.chain_name,e.address)
      and md5(coalesce(s.hours,''))=e."expectedHoursHash") <> ${changes.length}
  then raise exception 'Store identity or hours changed since planning; abort refresh'; end if;
end $$;
update public.stores s set hours=e.hours from hours_refresh e where s.id=e.id;
commit;`
  const report={generatedAt:new Date().toISOString(),inputs:files,observations:observations.length,changes:changes.length,applied:false}
  if(args.includes('--apply')) {
    databaseProcess(process.env.AAPRICE_DB_URL,sql)
    const verified=databaseProcess(process.env.AAPRICE_DB_URL,`\\pset tuples_only on
\\pset format unaligned
with e as (select * from jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) as x(id text,hours text))
select json_build_object('checked',count(*),'mismatched',count(*) filter(where s.id is null or s.hours is distinct from e.hours)) from e left join public.stores s using(id);`)
    report.verification=JSON.parse(verified.slice(verified.indexOf('{')))
    report.applied=true
    await writeFile(out+'/report.json',JSON.stringify(report,null,2))
    assert.equal(report.verification.checked,changes.length);assert.equal(report.verification.mismatched,0)
  }
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
