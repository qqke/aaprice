import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {databaseProcess} from './sync-sundrug.mjs'
import {createFetcher} from './crawl-national-stores.mjs'
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-national-universe-2026-10-03'
await mkdir(out,{recursive:true})
const get=await createFetcher(out,process.argv.includes('--offline'),process.argv.includes('--resume'))
const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from (select chain_name,count(*) as stores from public.stores group by chain_name order by chain_name) s;")
const chains=JSON.parse(raw.slice(raw.indexOf('[')))
const snapshot={generatedAt:new Date().toISOString(),totalRows:chains.reduce((n,x)=>n+Number(x.stores),0),chains}
await writeFile(`${out}/database-chain-counts.json`,JSON.stringify(snapshot,null,2))
// Exact franchise bindings avoid assigning every Matsumoto Kiyoshi store to Yasui.
const franchiseRaw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from(select id,name,chain_name,address from public.stores where id in ('mcc-52204388','mcc-52204446'))s;")
const franchiseRows=JSON.parse(franchiseRaw.slice(franchiseRaw.indexOf('[')))
const franchiseProof=[{id:'mcc-52204388',name:'薬 マツモトキヨシ 西葛西駅前店',address:'東京都江戸川区西葛西6-16-1'},{id:'mcc-52204446',name:'薬 マツモトキヨシ 行徳駅前店',address:'千葉県市川市行徳駅前2-13-1'}]
const yasuiBound=franchiseProof.filter(expected=>franchiseRows.some(row=>row.id===expected.id&&row.name===expected.name&&row.address===expected.address&&row.chain_name==='マツモトキヨシ'))
const old=JSON.parse(await readFile('artifacts/drugstores-membership-2026-10-03/membership-coverage.json','utf8'))
const extra={
'株式会社ケアーズ':['ケアーズ','ケアーズドラッグ'],'株式会社くすりのコーエイ':['ドラッグコーエイ','くすりのコーエイ'],'株式会社クスリのサンロード':['クスリのサンロード'],'株式会社くすりのダイイチ':['くすりのダイイチ'],'株式会社くすりのマルト':['くすりのマルト'],'株式会社コメヤ薬局':['コメヤ薬局'],'株式会社サンキュードラッグ':['サンキュードラッグ'],'株式会社下川薬局':['シモカワ'],'株式会社同仁堂':['同仁堂'],'株式会社ザグザグ':['ザグザグ'],'株式会社奈良ドラッグ':['エムズドラッグ','MSドラッグ'],'株式会社ニシイチドラッグ':['ニシイチドラッグ'],'株式会社西本真生堂':['西本真生堂'],'株式会社ハシドラッグ':['ハシドラッグ'],'株式会社阪神薬局':['阪神薬局'],'光株式会社':['ドラッグひかり'],'株式会社ファーマシー木のうた':['木のうた'],'株式会社ホッタ晴信堂薬局':['ホッタ晴信堂薬局'],'株式会社三河薬品':['三河薬品'],'株式会社ミズ':['ミズ','溝上薬局'],'株式会社ミック・ジャパン':['ミック薬局','ミック・ジャパン'],'株式会社村源':['村源'],'株式会社明治堂薬品':['明治堂薬品'],'株式会社ヤスイ':['ヤスイ'],'株式会社ヤマザワ薬品':['ドラッグヤマザワ','ヤマザワ薬品'],'株式会社横浜ファーマシー':['スーパードラッグアサヒ'],'株式会社ヨネキ十字堂':['ヨネキ十字堂'],'株式会社大屋':['ドラッグストアmac','ドラッグストアmac（大屋）','ドラッグストアマック'],'山田薬品株式会社':['Cosmetics and Medical','コスメティクスアンドメディカル'],'ユニバーサルドラッグ株式会社':['ユニバーサルドラッグ']}
extra['株式会社オストジャパングループ']=['ドラッグセイムス']
extra['株式会社ナチュラルホールディングス']=['ドラッグストアモリ','ザグザグ']
// CFIZ trade name is established by the current group company page and official integrated report.
extra['株式会社なの花西日本']=['なの花ドラッグ']
extra['(株)CFIZ']=['ココカラファインイズミヤ']
extra['有限会社大手町薬局']=['大手町薬局']
extra['株式会社タイキファーマシー']=['タイキファーマシー']
extra['株式会社青葉堂グループ']=['青葉堂グループ']
extra['株式会社アクシス']=['ウエーブ']
extra['内山薬品株式会社']=['佐々木薬局']
extra['株式会社柏葉薬局']=['カシワバ薬局']
extra['株式会社木山薬局']=['木山薬局グループ']
extra['株式会社オダギリ']=['オダギリ薬局']
extra['有限会社タカヤマ']=['タカヤマ']
extra['株式会社フジタ薬局']=['フジタ薬局']
extra['株式会社ミック・ジャパン']=['ドラッグミック','ローソン+ドラッグミック']
extra['山口薬品株式会社']=['山口薬品']
extra['株式会社レークケア']=['レークケア']
// Group directory spans several operators; these brands are group matches, not a legal-owner assignment per branch.
extra['株式会社リーフ']=['ヒノミドラッグ','テン・ドラッグ','ウィング湘南','ドラッグなかがわ']
const directories={
'有限会社大手町薬局':'https://www.ohtemachi-ph.com/group',
'株式会社タイキファーマシー':'https://taiki-p.com/',
'株式会社ヤスイ':'https://www.e-kusuri.info/drugstore',
'株式会社青葉堂グループ':'https://www.aobado.com/',
'株式会社アクシス':'https://www.axisnet.jp/',
'内山薬品株式会社':'https://www.uchiyama-sasaki.com/',
'株式会社柏葉薬局':'http://www.kashiwaba-ph.com/',
'株式会社木山薬局':'https://www.kiyama-drug.com/',
'株式会社オダギリ':'https://www.keimeido.co.jp/shop/kanagawa',
'有限会社タカヤマ':'https://takayama-ph.jp/pharmacy/',
'株式会社フジタ薬局':'https://fujitayr.shop-pro.jp/?mode=f2',
'株式会社ミック・ジャパン':'https://mikjapan.co.jp/archives/service/ds',
'山口薬品株式会社':'https://www.yamayaku.com/about/',
'株式会社レークケア':'https://kouga-yakkyoku-kounan.com/company/otc.php',
'株式会社リーフ':'https://ggwh.jp/store/?type=drug-store',
'株式会社なの花西日本':'https://www.nanohana-ph.jp/drugstore.php',
'(株)CFIZ':'https://www.matsukiyococokara.com/company/group/cocokara/cc_cfiz/',
'株式会社ケアーズ':'http://www.caresdrug.com/','株式会社くすりのコーエイ':'https://www.drugkoei.com/shop/','株式会社くすりのダイイチ':'https://www.kusu1.com/shop.html','株式会社くすりのマルト':'https://drug-maruto.jp/shopinfo','株式会社コメヤ薬局':'https://komeya-drug.com/store/','株式会社下川薬局':'https://www.shimokawa-ph.co.jp/archives/store','株式会社同仁堂':'https://dojindo-pharmacy.com/store','株式会社ニシイチドラッグ':'https://nishiichi.co/store/','株式会社西本真生堂':'https://drug-nishimoto.com/store/','株式会社ハシドラッグ':'https://www.hashi-drug.co.jp/store','光株式会社':'http://drug-hikari.co.jp/tenpo/','株式会社ファーマシー木のうた':'https://kinouta.co.jp/店舗案内','株式会社横浜ファーマシー':'https://drug-asahi.co.jp/ten.html','株式会社ヨネキ十字堂':'https://www.yoneki-jujido.co.jp/store'}
const membershipPage=await get(old.source)
const section=membershipPage.html.slice(membershipPage.html.indexOf('2026年度 正会員企業'))
const end=section.indexOf('JACDS について'),content=end>=0?section.slice(0,end):section
const members=[...content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter(m=>/pl-4|child-link/.test(m[1])).map(m=>({name:m[2].replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim(),url:m[1].match(/href=["']([^"']+)["']/)?.[1]||null,child:/child-link/.test(m[1])}))
if(!members.length)throw new Error('Official membership page has no parsed company entries')
const previous=new Map(old.coverage.map(row=>[row.name,row]))
old.coverage=members.map(member=>({...previous.get(member.name),...member,brandAliases:previous.get(member.name)?.brandAliases||[],status:previous.get(member.name)?.status||'unresolved_company_brand_mapping'}))
old.topLevelEntries=members.filter(x=>!x.child).length;old.childEntries=members.filter(x=>x.child).length
await writeFile(`${out}/jacds-member-links.json`,JSON.stringify({source:old.source,collectedAt:membershipPage.collectedAt,links:members},null,2))
const coverage=old.coverage.map(x=>{const bound=x.name==='株式会社ヤスイ'?yasuiBound:[],aliases=[...new Set([...x.brandAliases,...(extra[x.name]||[])])],matched=bound.length?[{chain_name:'マツモトキヨシ',stores:bound.length,scope:'Only exact official franchise IDs, not all brand branches'}]:chains.filter(c=>aliases.includes(c.chain_name));return {...x,exactDatabaseBindings:bound,franchiseBindingSourceUrl:bound.length?'https://www.e-kusuri.info/drugstore':null,brandAliases:aliases,matchedChains:matched,databaseRows:matched.reduce((n,c)=>n+Number(c.stores),0),officialDirectoryUrl:directories[x.name]||null,status:matched.length?'brand_present_branch_reconciliation_required':x.status==='business_scope_review'?'business_scope_review':'unresolved_brand_or_zero_matching_rows'}})
const stats={};for(const row of coverage)stats[row.status]=(stats[row.status]||0)+1
await writeFile(`${out}/membership-coverage.json`,JSON.stringify({generatedAt:new Date().toISOString(),source:old.source,topLevelEntries:old.topLevelEntries,childEntries:old.childEntries,stats,scope:'JACDS companies and subsidiaries only. Brand presence does not establish complete branch coverage. Independent stores and other retailers require licensing universe reconciliation.',coverage},null,2))
console.log(JSON.stringify({databaseRows:snapshot.totalRows,chains:chains.length,stats}))
if(process.argv.includes('--probe-unresolved')){
 const pending=coverage.filter(x=>x.status==='unresolved_brand_or_zero_matching_rows'),results=[]
 for(const row of pending){
  let url=row.officialDirectoryUrl||row.url
  if(!url){results.push({...row,probeStatus:'no_published_url',enumerationComplete:false});continue}
  if(!/^https?:/.test(url))url='https://'+url
  try{const page=await get(url),html=page.html.replace(/<!--[\s\S]*?-->/g,''),links=[...html.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g)].flatMap(m=>{const label=m[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();if(!/店舗|お店|店を探|薬局一覧|ショップ|店舗情報|支店/.test(label))return [];try{return [{label,url:new URL(m[1].replaceAll('&amp;','&'),url).href}]}catch{return []}})
   results.push({...row,probeStatus:'official_page_fetched',probeUrl:url,collectedAt:page.collectedAt,pageTitle:html.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]||'',directoryCandidates:[...new Map(links.map(l=>[l.url,l])).values()],enumerationComplete:false})
  }catch(e){results.push({...row,probeStatus:'official_fetch_failed',probeUrl:url,error:e.message,enumerationComplete:false})}
  await writeFile(`${out}/unresolved-official-directories.json`,JSON.stringify(results,null,2));console.log(row.name,results.at(-1).probeStatus)
 }
}
