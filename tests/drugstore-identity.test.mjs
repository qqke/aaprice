import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalStoreIdentity,possibleExistingBranches} from '../scripts/drugstore-identity.mjs'
test('Brand suffix and group prefix resolve to same branch, but separate brands do not',()=>{
  const old={name:'扶桑店-サンドラッグ',chain_name:'サンドラッグ',address:'愛知県丹羽郡扶桑町７－１'}
  const fresh={name:'サンドラッググループ 扶桑店',chain_name:'サンドラッググループ',address:'愛知県丹羽郡扶桑町7-1'}
  assert.equal(canonicalStoreIdentity(old),canonicalStoreIdentity(fresh))
  assert.equal(canonicalStoreIdentity({...old,name:'サンドラッグ サンドラッグ 扶桑店'}),canonicalStoreIdentity(old))
  assert.notEqual(canonicalStoreIdentity(old),canonicalStoreIdentity({...fresh,chain_name:'別ブランド'}))
  assert.notEqual(canonicalStoreIdentity(old),canonicalStoreIdentity({...fresh,address:'愛知県丹羽郡扶桑町7-2'}))
})

test('Missing-only import reviews moves and same-source rebranding before inserting',()=>{
  const old={id:'welcia-1',name:'ウエルシア中央店',chain_name:'ウエルシア',address:'東京都新宿区1-1',pref:'東京都'}
  assert.deepEqual(possibleExistingBranches({...old,id:'welcia-2',address:'東京都新宿区2-2'},[old]),[old.id])
  assert.deepEqual(possibleExistingBranches({...old,id:'welcia-3',name:'コクミン中央店',chain_name:'コクミン'},[old]),[old.id])
  assert.deepEqual(possibleExistingBranches({...old,id:'welcia-4',name:'ウエルシア東店',address:'東京都新宿区2-2'},[old]),[])
  assert.deepEqual(possibleExistingBranches({...old,id:'welcia-5',pref:'大阪府',address:'大阪府大阪市1-1'},[old]),[])
})

test('Government business names require existing-branch review despite brand labels and building address differences',()=>{
  const existing={id:'mcc-10001686',name:'薬 マツモトキヨシ モリタウン昭島店',chain_name:'マツモトキヨシ',address:'東京都昭島市代官山二丁目3-1モリタウン本館1F',pref:'東京都'}
  const permit={id:'license-tokyo-1',name:'薬マツモトキヨシ モリタウン昭島店',chain_name:'薬マツモトキヨシ モリタウン昭島店',address:'東京都昭島市代官山2-3-1',pref:'東京都'}
  assert.deepEqual(possibleExistingBranches(permit,[existing]),[existing.id])
  assert.deepEqual(possibleExistingBranches({...permit,name:'薬マツモトキヨシ 別店'},[existing]),[])
  const group={...existing,id:'sundrug-1187',name:'サンドラッググループ 麻布台ヒルズ店',chain_name:'サンドラッググループ'}
  assert.deepEqual(possibleExistingBranches({...permit,name:'サンドラッグ麻布台ヒルズ店',chain_name:'サンドラッグ麻布台ヒルズ店'},[group]),[group.id])
})
