import test from 'node:test';import assert from 'node:assert/strict';
import {parseMikCompanyTable,parseGGDrugStores,parseLakeRetail,parseYamaguchiRetail} from '../scripts/crawl-membership-retail-c.mjs';
test('membership C parsers keep retail format, source phones and mall branch identity',()=>{
 const m=parseMikCompanyTable('<table><tr><th>店舗名</th></tr><tr><td>曽根駅前店</td><td>〒561-0802<br>豊中市曽根東町3-2-1</td><td>☎06-6865-3339</td><td>詳細</td></tr></table>','https://official.test/mik');assert.equal(m.length,1);assert.equal(m[0].name,'ドラッグミック曽根駅前店');assert.equal(m[0].address,'大阪府豊中市曽根東町3-2-1');assert.equal(m[0].phone,'06-6865-3339');assert.equal(m[0].lat,undefined);
 const g=parseGGDrugStores('<div class="store__blockSingle"><h3>テン・ドラッグ西川口店</h3><table><tr><th>所在地</th><td>〒332-0021 埼玉県川口市西川口1-9-8 [<a>GoogleMap</a>]</td></tr><tr><th>TEL.</th><td>048-254-5868</td></tr><tr><th>営業時間</th><td>9:00～翌日2:00</td></tr></table></main>','https://official.test/store/?type=drug-store');assert.equal(g[0].address,'埼玉県川口市西川口1-9-8');assert.equal(g[0].chain_name,'テン・ドラッグ');assert.match(g[0].retailEvidence,/excluding dispensing/);
 const l=parseLakeRetail('<p><span class="minititle">甲賀みえる薬局</span>〒520-3432 滋賀県甲賀市甲賀町滝2235-1 TEL : 0748-88-7002</p><p><span class="minititle">蒲生ドラッグ</span>〒529-1537 滋賀県東近江市市子殿町1386 TEL : 0748-55-4050</p>','https://official.test/otc');assert.equal(l.length,2);assert.equal(l[0].excluded,true);assert.equal(l[1].excluded,false);
 const y=parseYamaguchiRetail('<tr><th>山口薬局<br>大町店<a>LINE登録はこちら</a></th><td><a id="ohmachi" class="anchor"></a>福島県郡山市大町2丁目15-2 TEL.024-939-2929 ■ 営業時間 月〜土9:00～18:00 ■ 休業日 日祝 要指導医薬品・一般医薬品販売</td></tr><tr><th>コスモス湯本調剤薬局</th><td><a id="cosmos" class="anchor"></a>福島県いわき市常磐湯本町台山55-4 TEL.0246-72-0066 医療DX</td></tr>','https://official.test/about/');assert.equal(y.length,2);assert.equal(y[0].name,'山口薬局大町店');assert.equal(y[0].excluded,false);assert.equal(y[1].excluded,true);assert.equal(y[0].phone,'024-939-2929');
});

test('commented historical directory entries are excluded',()=>{
 const fixtures=[
 [parseMikCompanyTable,'<tr><td>旧店</td><td>大阪府大阪市1-1</td><td>06-1234-5678</td><td>詳細</td></tr>'],
 [parseGGDrugStores,'<div class="store__blockSingle"><h3>旧店</h3></main>'],
 [parseLakeRetail,'<p><span class="minititle">蒲生ドラッグ</span>〒529-1537 滋賀県東近江市市子殿町1386 TEL : 0748-55-4050</p>'],
 [parseYamaguchiRetail,'<tr><th>旧店</th><td><a id="old" class="anchor"></a>福島県郡山市大町2丁目15-2 TEL.024-939-2929 要指導医薬品・一般医薬品販売</td></tr>']
 ];for(const [parser,html]of fixtures){assert.equal(parser(html,'https://official.test').length,1);assert.deepEqual(parser('<!--'+html+'-->','https://official.test'),[]);}
});
