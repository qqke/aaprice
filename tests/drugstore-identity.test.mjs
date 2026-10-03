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
