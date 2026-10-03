import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createFetcher,validateStore} from './crawl-national-stores.mjs';
import {databaseProcess} from './sync-sundrug.mjs';
import {indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs';
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs';
import {pathToFileURL} from 'node:url';
import {normalizeAddress} from './crawl-eastern-license-registry.mjs';

export function parseKanazawaLicense(r,source={}) {
 if(r['区分']!=='店舗販売業'||!r['施設名称']||!String(r['施設所在地']||'').startsWith('金沢市'))return null;
 const phone=String(r['施設TEL']||'').normalize('NFKC'),digits=phone.replace(/\D/g,'');
 return {id:'license-kanazawa-'+r['施設ID'],name:r['施設名称'].normalize('NFKC'),address:normalizeAddress('石川県'+r['施設所在地']),pref:'石川県',city:'金沢市',phone:digits.length===7?'076-'+phone:phone,phoneRaw:phone,chain_name:'独立薬店',sourceUrl:source.url,sourceAsOf:source.asOf,scope:'金沢市 only',licenseNumber:r['許可番号'],licenseStart:r['許可年月日'],governmentLat:r['緯度'],governmentLng:r['経度']};
}
export function parseToyotaLicense(r,source={}) {
 if(!r[0]||!r[2]||!String(r[3]||'').startsWith('豊田市'))return null;
 const address=normalizeAddress('愛知県'+r[3]);
 return {id:'license-toyota-'+createHash('sha256').update(r[0]+'|'+address).digest('hex').slice(0,16),name:r[2].normalize('NFKC'),address,pref:'愛知県',city:'豊田市',phone:String(r[4]||''),chain_name:'独立薬店',sourceUrl:source.url,sourceAsOf:source.asOf,scope:'豊田市 only',licenseNumber:r[0],licenseStart:r[6],licenseExpiry:r[7]};
}

async function main(){
const out=process.env.CENTRAL_REMAINING_OUT||'artifacts/drugstores-license-central-remaining-2026-10-03',get=await createFetcher(out,false,true),sources=JSON.parse(await readFile(out+'/source-index.json')),kanazawa=JSON.parse(await readFile(out+'/cache/kanazawa-datastore.json')).data.result.records,toyota=Object.values(JSON.parse(await readFile(out+'/toyota-retail.rows.json')))[0].slice(1),licenses=[...kanazawa.map(r=>parseKanazawaLicense(r,sources[0])),...toyota.map(r=>parseToyotaLicense(r,sources[1]))].filter(Boolean),rows=licenses.filter(r=>/薬|くすり|ドラッグ|漢方/.test(r.name)&&!/通販|オンライン|ネット|本社|営業部|製薬|マックスバリュ|イオン|平和堂|共済会|SAIBI|アオキ|マツモト|ココカラ|スギ|キリン|V・|Vドラッグ|ゲンキー|ウエルシア|ツルハ|サンドラッグ|サンドラック|コメヤ|シメノ|ビー・アンド・ディー/.test(r.name));
const result=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from (select id,name,chain_name,address,pref,lat,lng from public.stores) s;"),db=JSON.parse(result.slice(result.indexOf('['))),index=indexExistingBranches(db),stores=[],attempts=[];
const distance=(a,b)=>{const lat=(a.lat-b.lat)*Math.PI/180,lng=(a.lng-b.lng)*Math.PI/180;return 6371000*2*Math.asin(Math.sqrt(Math.sin(lat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(lng/2)**2))};
await writeFile(out+'/normalized-license-rows.json',JSON.stringify(licenses,null,2));
for(let i=0;i<rows.length;i+=4){await Promise.all(rows.slice(i,i+4).map(async row=>{let errors=[];const existing=possibleExistingBranches(row,index);if(existing.length){attempts.push({id:row.id,status:'existing-review',existing});return;}for(const query of [row.name+' '+row.address,row.name+' '+row.phone,row.name]){const url='https://www.google.com/maps?q='+encodeURIComponent(query)+'&output=embed&hl=ja';try{const page=await get(url),marker=parseOfficialEmbedMarker(page.html,row);verifyMarkerAddress(marker,row);if(/閉業|permanently closed/.test(page.html))throw Error('Possible permanent closure');const nearby=db.filter(d=>Number.isFinite(Number(d.lat))&&distance(marker,{lat:Number(d.lat),lng:Number(d.lng)})<60);if(nearby.length)throw Error('DB store within 60m: '+nearby.map(d=>d.id).join(','));const repeat=stores.find(d=>distance(marker,d)<60);if(repeat)throw Error('Staged store within 60m '+repeat.id);const id=row.id;stores.push(validateStore({...row,...marker,id,licenseSourceRowId:row.id,city:row.address.replace(row.pref,'').match(/^.+?(?:市|町|村)/)?.[0]||'',coordinateSourceUrl:url,coordinateSourceType:'third-party-public-business-marker',coordinateCollectedAt:page.collectedAt,collectedAt:new Date().toISOString()}));attempts.push({id:row.id,newId:id,status:'accepted',url});return;}catch(e){errors.push({query,reason:e.message})}}attempts.push({id:row.id,name:row.name,status:'pending',errors});}));console.log('Processed',attempts.length,'accepted',stores.length);await writeFile(out+'/stores.json',JSON.stringify(stores,null,2));await writeFile(out+'/attempts.json',JSON.stringify(attempts,null,2));}
await writeFile(out+'/report.json',JSON.stringify({generatedAt:new Date().toISOString(),databaseCount:db.length,sourceLicenseRows:licenses.length,sourceScopes:sources,candidateCount:rows.length,accepted:stores.length,pending:attempts.filter(a=>a.status!=='accepted').length,nationalComplete:false,limitations:['Dataset note is 2025-04-01; resource modification does not establish snapshot date','Other seven prefectures and independent cities remain unresolved','Permit snapshot plus current business marker identity, no inference of closure from absence','Physical format and within60m existing store quarantines']},null,2));

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
