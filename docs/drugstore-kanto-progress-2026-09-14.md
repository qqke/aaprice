# 关东药妆门店续采（2026-09-14）

本轮优先抓取关东未完成的详情数据，未执行数据库导入。

## アインズ＆トルペ

从 https://ainz-tulpe.jp/blogs/shop 重新读取全国 113 家目录，筛选关东 58 家：东京 33、神奈川 15、埼玉 6、千叶 3、栃木 1；该品牌本次目录未列出茨城、群马门店，不代表这两县没有其他药妆店。

58 个详情页全部抓取成功，并提取地址、营业时间、交通方式、电话及页面提供的付款方式。58 个 ID 唯一，详情地址与目录全部一致。仅新宿东口详情含 Google 地图嵌入链接，其中坐标为视窗中心；未据此生成精确门店坐标。58 条继续保留待核查坐标及零售药妆分类。

结果目录：`artifacts/drugstores-kanto-2026-09-14/`。`directory.json` 为本次关东目录，`detail-fields.json` 为详情字段，`pending.json` 为合并后的待核查记录，`cache/` 保存带来源 URL 和时间的原始响应，`verification.json` 为核查结果。

## 龍生堂

重新抓取 https://www.ryuseido.co.jp/shop/index.html 及全部 26 个详情页，请求失败 0。排除独立调剂店 1 条；24 条待精确坐标，APii COSMETICS 1 条待分类核查，合计待核查 25 条。

结果目录：`artifacts/drugstores-ryuseido-2026-09-14/`。

## 验证及后续

`node --test tests/fitcare-ainz.test.mjs tests/ryuseido.test.mjs`：3 项通过。另核查 58 条详情的 ID 唯一性、地址一致性和两批请求失败数，均通过。

本轮完成 84 个详情页采集；不是新增 84 家门店，新增入库为 0。后续优先补齐这两批关东记录的可靠位置证据，再与实时数据库核对身份去重。当前无后台采集任务。
