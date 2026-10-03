import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKanazawaLicense,parseToyotaLicense} from '../scripts/crawl-central-remaining-license-registry.mjs';
test('Central remaining registry parsers preserve official scope, license and telephone evidence without manufacturing coordinates',()=>{
 const source={url:'https://official.example/permit',asOf:'2025-04-01'};
 const k=parseKanazawaLicense({'区分':'店舗販売業','施設名称':'田中屋薬舗','施設所在地':'金沢市堀川町１０－５','施設ID':1,'施設TEL':'233-3691','緯度':36.1,'経度':136.2,'許可番号':9},source);
 assert.equal(k.phone,'076-233-3691');assert.equal(k.phoneRaw,'233-3691');assert.equal(k.address,'石川県金沢市堀川町10-5');assert.equal(k.sourceAsOf,'2025-04-01');assert.equal(k.governmentLat,36.1);assert.equal(k.lat,undefined);
 assert.equal(parseKanazawaLicense({'区分':'薬局','施設名称':'調剤のみ','施設所在地':'金沢市'},source),null);
 assert.equal(parseKanazawaLicense({'区分':'店舗販売業','施設名称':'県外','施設所在地':'富山市'},source),null);
 const t=parseToyotaLicense(['許可１','第2類','藤堂自然薬舗','豊田市市木町２丁目２－１','0565-80-9261',null,'2022-01-01','2028-01-01'],{...source,asOf:'2026-08-31'});
 assert.equal(t.address,'愛知県豊田市市木町2-2-1');assert.equal(t.phone,'0565-80-9261');assert.equal(t.licenseExpiry,'2028-01-01');assert.equal(t.sourceAsOf,'2026-08-31');assert.equal(t.lat,undefined);
 assert.equal(parseToyotaLicense(['許可番号',null,'店舗名','店舗所在地','電話番号']),null);
 assert.equal(parseToyotaLicense(['A',null,'県外','岡崎市町1']),null);
});
