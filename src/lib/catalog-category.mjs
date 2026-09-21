// Display-only groups. Keep the supplier category on the product for detail/search.
export function getCatalogCategory(product) {
  const category = String(product.category || "").normalize("NFKC")
  const name = String(product.name || "").normalize("NFKC")
  const groups = [
    ["宠物用品", /ペット|犬用|猫用|キャット|ドッグ|宠物/],
    ["母婴用品", /ベビー|育児|哺乳|婴|母婴/],
    ["日常护理", /日常护理|シャンプー|コンディショナー|ヘア|スカルプ|ボディソープ|歯|ハミガキ|デンタル|口腔|洗发|护发/],
    ["护肤美妆", /护肤|美妆|保湿|防晒|化粧|コスメ|美容|乳液|クリーム|洗顔|クレンジング|リップ|ネイル|日焼け|UV|スキンケア|メイク/],
    ["营养保健", /营养|保健|サプリ|ビタミン|健康食品|プロテイン/],
    ["医药品", /医药|医薬品|止痛|退热|眼部|目薬|点眼|鎮痛|鼻炎|胃腸|かぜ|風邪/],
    ["家居日用", /家居|日用|洗剤|洗濯|掃除|清掃|台所|キッチン|消臭|除菌/],
    ["食品饮料", /食品|飲料|饮料|菓子|お茶|コーヒー/],
  ]
  // A specific supplier category takes precedence; tax and brand labels fall
  // through to the name. Unknown products remain reachable under “其他”.
  const specific = groups.find(([, pattern]) => pattern.test(category))
  if (specific && !/^(医药品|医薬品|日用品・洗剤)$/.test(category)) return specific[0]
  return groups.find(([, pattern]) => pattern.test(name))?.[0] || specific?.[0] || "其他"
}
