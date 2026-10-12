import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {basename} from 'node:path'
import {pathToFileURL} from 'node:url'
import {csvCell} from './sync-sundrug.mjs'
import {validateStore,prefectures} from './crawl-national-stores.mjs'

export function buildSourceInventory(inputs,now=Date.now()) {
  const records=new Map();let skipped=0
  for(const {file,rows} of inputs) {
    assert(Array.isArray(rows),'Source file must contain an array')
    for(const row of rows) {
      const time=Date.parse(row.collectedAt),url=row.sourceUrl||row.sourceListUrl
      if(!row.name||!row.address||!/^https?:\/\//.test(url||'')||!Number.isFinite(time)||time>now||now-time>86400000){skipped++;continue}
      const verified=/^stores(?:-corrected)?\.json$/.test(basename(file))&&!row.closedOn&&row.coordinateAccuracy!=='map-center'&&row.coordinateStatus!=='precise-location-unverified'
      if(verified)validateStore(row)
      const state=row.closedOn?'已确认闭店':verified?'位置已核验':basename(file).startsWith('excluded')?'未通过当前校验':'待核记录'
      const declared=String(row.pref||'').normalize('NFKC').trim().replace(/^\?+/,'')
      const address=String(row.address).normalize('NFKC').trim().replace(/^〒[\d-]+\s*/,'').replace(/^\?+/,'')
      const record={id:row.id||'',name:row.name,chain_name:row.chain_name||'未确定',address:row.address,
        pref:prefectures.find(p=>address.startsWith(p))||(prefectures.includes(declared)?declared:''),
        phone:row.phone||'',lat:verified?row.lat:'',lng:verified?row.lng:'',hours:row.hours||'',state,
        review:row.closedOn?`闭店日期 ${row.closedOn}`:row.reason||row.contactIssue||row.status||row.scopeStatus||'',
        sourceUrl:url,collectedAt:row.collectedAt,sourceFile:file}
      const key=[url,record.id,record.name,record.address,record.phone].join('\0'),previous=records.get(key)
      if(!previous||Date.parse(previous.collectedAt)<time||previous.state==='待核记录'&&verified)records.set(key,record)
    }
  }
  const rows=[...records.values()].sort((a,b)=>a.pref.localeCompare(b.pref,'ja')||a.name.localeCompare(b.name,'ja'))
  const fields=['id','name','chain_name','address','pref','phone','lat','lng','hours','state','review','sourceUrl','collectedAt','sourceFile']
  // Public source text must remain text when opened in a spreadsheet.
  const cell=value=>csvCell(typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value)
  return {rows,skipped,csv:'\uFEFF'+[fields.map(cell).join(','),...rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n')}
}

async function main() {
  const args=process.argv.slice(2),out=args.find(s=>s.startsWith('--out='))?.slice(6)
  assert(out,'Pass --out=DIR and source JSON files')
  const files=args.filter(s=>!s.startsWith('--'));assert(files.length,'No source files')
  const inputs=[];for(const file of files)inputs.push({file,rows:JSON.parse(await readFile(file,'utf8'))})
  const result=buildSourceInventory(inputs);await mkdir(out,{recursive:true})
  await writeFile(out+'/source-inventory.csv',result.csv)
  const report={generatedAt:new Date().toISOString(),inputs:files,sourceObservations:result.rows.length,skippedUnusableOrStale:result.skipped,
    prefectures:[...new Set(result.rows.map(r=>r.pref).filter(Boolean))].sort(),
    states:result.rows.reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{}),nationalComplete:false,
    scope:'Includes current retrieved source observations awaiting scope, identity, coordinates or operating-status checks. Different source records can refer to the same business; not a unique-store census.'}
  await writeFile(out+'/inventory-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,inputs:files.length}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
