import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSeimsStore,seimsUrl} from '../scripts/crawl-seims-directory.mjs'
test('SEIMS joins identities, requires retail flag and avoids Yutaka duplicate coverage',()=>{
  const identity={key:'1',name:'ドラッグセイムス テスト店',address:'東京都新宿区1',latitude:35.69,longitude:139.7}
  const detail={...identity,extra_fields:{'ドラッグストア':'1','ｶﾝﾊﾞﾝ種類（屋号）':'1'},marker:{ja:{name:'ドラッグセイムス'}}}
  assert.equal(parseSeimsStore(identity,detail,'2026-09-13').id,'seims-group-1')
  assert.throws(()=>parseSeimsStore(identity,{...detail,key:'2'}),/Identity/)
  assert.throws(()=>parseSeimsStore(identity,{...detail,extra_fields:{}}),/retail/)
  assert.throws(()=>parseSeimsStore(identity,{...detail,extra_fields:{'ドラッグストア':'1','ｶﾝﾊﾞﾝ種類（屋号）':'2'}}),/Yutaka/)
  assert.equal(new URL(seimsUrl('')).searchParams.get('backend_filters'),encodeURI('{}'))
})
