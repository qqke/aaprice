import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {validateStore} from './crawl-national-stores.mjs'
const base='https://map.sapporo.coop',out='artifacts/drugstores-coop-drug-2026-10-03'
export function nextPage(html){const text=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];if(!text)throw Error('Missing official Next data');return JSON.parse(text).props.pageProps}
export function parseCoopDrug(shop,collectedAt){
 if(shop.openStatus!=='IS_ALREADY_OPEN')throw Error('Not currently established/open')
 const products=shop.cmsItemValues?.map(x=>x.content).find(x=>x.keyword==='products'&&x.checkBoxComposite)
 const flag=products?.checkBoxComposite.items.find(x=>x.text==='コープドラッグ')
 if(!flag?.checked)throw Error('No checked Co-op Drug department')
 const note=[products.remarks?.top,products.remarks?.bottom].filter(Boolean).join(' ').replace(/<[^>]*>/g,' ').normalize('NFKC')
 if(/閉店(?!\s*\d{1,2}[:：])|休業中|販売休止|休止中|オープン予定/.test(note))throw Error('Drug department closure or suspension requires review')
 if(!/医薬品販売/.test(note))throw Error('No explicit current medicine-sales description')
 const hours=note.split(/(?=※)/).filter(part=>/コープドラッグ|医薬品|薬剤師/.test(part)).join(' ').trim()
 const phone=hours.match(/(?:TEL|(?:直)?電話(?:番号)?)[.：:]?[】）)]?\s*(0\d{1,4}[-‐ー]\d{1,4}[-‐ー]\d{3,4})/i)?.[1]||''
 return validateStore({id:'coopdrug-'+shop.storeCode,name:'コープドラッグ '+shop.nameKanji,chain_name:'コープドラッグ',address:shop.address,lat:Number(shop.latitude),lng:Number(shop.longitude),phone,contactPhone:phone||shop.tel,contactPhoneScope:phone?'drug-department':'parent-supermarket',hours,sourceUrl:base+'/store/detail/'+shop.storeCode+'/',sourceStoreCode:shop.storeCode,sourcePlaceId:shop.placeId||'',collectedAt,coordinateSourceUrl:base+'/store/detail/'+shop.storeCode+'/',coordinateEvidence:'Official store-level coordinates for explicitly listed in-store Co-op Drug department; shared premises, not independently surveyed drug-counter point',coordinateScope:'official-shared-premises',departmentEvidence:note,requiresSharedPremisesReview:true})
}
async function main(){
 await mkdir(out+'/cache',{recursive:true})
 async function page(path,key){const file=out+'/cache/'+key+'.json';try{return JSON.parse(await readFile(file,'utf8'))}catch{const response=await fetch(base+path,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('HTTP '+response.status);const result={sourceUrl:base+path,collectedAt:new Date().toISOString(),data:nextPage(await response.text())};await writeFile(file,JSON.stringify(result));return result}}
 const first=await page('/store/all/','directory-1'),shops=new Map(first.data.shops.map(s=>[s.storeCode,s])),directoryPages=[first.sourceUrl]
 for(let p=2;p<=first.data.maxPage;p++){const result=await page('/store/all/?page='+p,'directory-'+p);directoryPages.push(result.sourceUrl);if(result.data.totalCount!==first.data.totalCount)throw Error('Directory count changed during crawl');for(const s of result.data.shops)shops.set(s.storeCode,s)}
 if(shops.size!==first.data.totalCount)throw Error('Incomplete official directory enumeration')
 const stores=[],pending=[],excluded=[],details=[]
 const rows=[...shops.values()]
 for(let i=0;i<rows.length;i+=4){await Promise.all(rows.slice(i,i+4).map(async row=>{try{const result=await page('/store/detail/'+row.storeCode+'/','detail-'+row.storeCode),shop=result.data.shop;if(!shop||shop.storeCode!==row.storeCode)throw Error('Detail identity mismatch');details.push({storeCode:row.storeCode,name:shop.nameKanji,sourceUrl:result.sourceUrl,openStatus:shop.openStatus});try{stores.push(parseCoopDrug(shop,result.collectedAt))}catch(e){const record={storeCode:row.storeCode,name:shop.nameKanji,sourceUrl:result.sourceUrl,reason:e.message};if(e.message==='No checked Co-op Drug department'||e.message==='Not currently established/open')excluded.push(record);else pending.push(record)}}catch(e){pending.push({storeCode:row.storeCode,name:row.nameKanji,reason:e.message})}}));console.log('checked',Math.min(i+4,rows.length),'/',rows.length)}
 for(const[name,data]of Object.entries({stores,pending,excluded,'directory-ledger':details}))await writeFile(out+'/'+name+'.json',JSON.stringify(data,null,2))
 const report={generatedAt:new Date().toISOString(),directoryPages,officialDirectoryCount:first.data.totalCount,uniqueDirectoryShops:shops.size,detailPagesVerified:details.length,accepted:stores.length,pending:pending.length,excluded:excluded.length,directoryEnumerationComplete:details.length===shops.size,allMedicineDepartmentRecordsAligned:false,limitations:['Accepted coordinates identify official shared supermarket premises; root review required before import','Unchecked department labels excluded; checked but medicine description missing held for review','Department telephone is kept separate from parent-supermarket contact']};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
