import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'
import {naviiOTCStock} from './crawl-membership-b-recovery.mjs'
import {textOf} from './crawl-membership-retail-b.mjs'
import {visibleHtml} from './crawl-membership-retail-a.mjs'

export function parseHealthsupportDirectory(html,url,collectedAt) {
  html=visibleHtml(html)
  const text=textOf(html).normalize('NFKC'),expected=Number(text.match(/健康サポート薬局\s*(\d+)施設/)?.[1])
  const date=text.match(/\((\d{4})\)年(\d+)月(\d+)日現在/)
  assert(expected>0&&date,'Missing published directory count/date')
  const asOf=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`,rows=[]
  const linkedRows=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].filter(m=>m[1].includes('/S2430/initialize?'))
  for(const [,tr] of linkedRows) {
    const cells=[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1])
    const link=cells.at(-3)?.match(/href="([^"]*iryou\.teikyouseido\.mhlw\.go\.jp[^"<>]+)"/)
    assert(link,'Incomplete government directory row')
    const detailUrl=link[1].replaceAll('&amp;','&'),code=new URL(detailUrl).searchParams.get('kikanCd')
    assert(code,'Missing government facility ID')
    rows.push({id:'healthsupport-tochigi-'+code,name:textOf(cells.at(-3)).normalize('NFKC'),
      address:'栃木県'+textOf(cells.at(-2)).normalize('NFKC'),pref:'栃木県',chain_name:'その他薬品販売店',
      operator:textOf(cells.at(-1)),sourceUrl:url,detailUrl,collectedAt,sourceAsOf:asOf,sourceDeclaredCount:expected,
      reason:`Government health-support pharmacy directory as of ${asOf}; individual OTC/operating status and location review required`})
  }
  assert.equal(rows.length,linkedRows.length,'Incomplete directory extraction')
  assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'Duplicate government facility ID')
  for(const row of rows)row.directoryCountMismatch=rows.length!==expected
  return rows
}

export function naviiField(html,label) {
  for(const [,tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))
    if(tr.match(/class="ptn1ItemName">([^<]+)/)?.[1]===label)return textOf(tr.match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1]||'')
  return ''
}

async function main() {
  const out=process.argv.find(s=>s.startsWith('--out='))?.slice(6)||'artifacts/drugstores-tochigi-healthsupport-2026-10-13'
  const get=await createFetcher(out,false,process.argv.includes('--resume')),url='https://www.pref.tochigi.lg.jp/e07/welfare/kusuri/kusuri/kennkousapo-to/kennminnmuke.html'
  const page=await get(url),rows=parseHealthsupportDirectory(page.html,url,page.collectedAt),pending=[]
  for(const row of rows) {
    try {
      const profile=await get(row.detailUrl),name=naviiField(profile.html,'名称')
      assert.equal(name.normalize('NFKC').replace(/\s/g,''),row.name.replace(/\s/g,''),'Government detail name differs')
      const address=naviiField(profile.html,'所在地').normalize('NFKC').replace(/\s*Googleマップで見る$/,'').trim()
      assert(address.startsWith('栃木県'),'Government detail lacks expected prefecture/address')
      row.directoryAddress=row.address;row.address=address
      row.directorySourceUrl=row.sourceUrl;row.sourceUrl=profile.url;row.collectedAt=profile.collectedAt
      row.phone=naviiField(profile.html,'営業日の開店時間内電話番号')
      row.officialWebsite=naviiField(profile.html,'薬局のホームページアドレス')
      row.otcStock=naviiOTCStock(profile.html)
      row.detailCollectedAt=profile.collectedAt
      row.reason=row.otcStock>0?`Exact government pharmacy profile declares ${row.otcStock} OTC items; current retail format/location review required`:'Individual OTC sale and current location require review'
    } catch(error){row.reason=error.message}
    pending.push(row);await writeFile(out+'/pending.json',JSON.stringify(pending,null,2))
    console.log(JSON.stringify({processed:pending.length,selected:rows.length,otcConfirmed:pending.filter(r=>r.otcStock>0).length}))
  }
  await writeFile(out+'/stores.json','[]')
  await writeFile(out+'/report.json',JSON.stringify({generatedAt:new Date().toISOString(),source:url,sourceAsOf:rows[0].sourceAsOf,
    sourceDeclaredCount:rows[0].sourceDeclaredCount,directoryCountMismatch:rows[0].directoryCountMismatch,
    sourceRows:rows.length,processed:pending.length,otcConfirmed:pending.filter(r=>r.otcStock>0).length,applied:false,nationalComplete:false},null,2))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
