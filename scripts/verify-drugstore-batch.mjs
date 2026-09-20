import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {databaseProcess} from './sync-sundrug.mjs'
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-parallel-2026-09-13'
const expected=JSON.parse(await readFile(`${out}/stores.json`,'utf8'))
const hex=Buffer.from(JSON.stringify(expected)).toString('hex')
const sql=`\\pset tuples_only on
\\pset format unaligned
with expected as (select * from jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) as x(id text,name text,chain_name text,address text,pref text,lat double precision,lng double precision,hours text))
select json_build_object('checked',count(*),'missing',count(*) filter(where s.id is null),'mismatched',count(*) filter(where (s.name,s.chain_name,s.address,s.pref,s.lat,s.lng,s.hours) is distinct from (e.name,e.chain_name,e.address,e.pref,e.lat,e.lng,e.hours))) from expected e left join public.stores s on s.id=e.id;`
const raw=databaseProcess(process.env.AAPRICE_DB_URL,sql)
const result=JSON.parse(raw.slice(raw.indexOf('{')))
await writeFile(`${out}/database-verification.json`,JSON.stringify({...result,checkedAt:new Date().toISOString()},null,2))
assert.equal(result.checked,expected.length);assert.equal(result.missing,0);assert.equal(result.mismatched,0)
console.log(JSON.stringify(result))
