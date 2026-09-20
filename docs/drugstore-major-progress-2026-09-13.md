# 日本药妆门店续采与入库：2026-09-13

截至本次实时核验，数据库 `public.stores` 共 **19,797 条**。这是含历史线上店、药局和零售店的数据库记录总数，不等于全国独立实体药妆店数量。

后续续采已新增 YACS 116 条、アルカ 48 条、ミネドラッグ 24 条、コクミン 1 条、マサヤ 3 条与ミヤモト薬局 11 条，当前数据库总数为 **19,836 条**。

本阶段从 18,275 条起，真实净增 **1,358 条**：SEIMS 系列 887、Genky 395、Fit Care 76。所有已应用批次逐字段核验均为 missing=0、mismatched=0。

| 来源 | 官方枚举 | 可用结果 | 本阶段入库处理 |
|---|---:|---:|---|
| Sundrug | 1,241 | 当前解析 999 | 核实匹配的 991 条按旧 ID 刷新，净增 0 |
| SEIMS / 富士药品 | 1,261 | 887 | 新增 887；排除独立调剂与已有 Yutaka 来源 |
| Genky | 540 | 395 | 新增 395；145 条待确认坐标或营业状态 |
| Kamegaya / Fit Care | 89 | 76 | 新增 76；排除 13 条其他美妆品牌 |
| アインズ＆トルペ | 113 | 待补坐标 113 | 官方列表已枚举，未逐一抓完详情，未入库 |
| ドラッグストアmac | 73 | 待补坐标 73 | 官方搜索总数与枚举一致，未入库 |
| Yamazawa 药品 | 50（第 1、2 页） | 待补坐标 50 | 已补抓分页，未使用地图视窗中心 |
| YACS / 千叶药品 | 116 | 116 | 已入库并逐字段核验 |
| アルカドラッグ | 109 | 48 | 48 入库；61 条待补 |
| ミネドラッグ | 24 | 24 | 已入库并逐字段核验 |

## Sundrug 重复批次修正

早期文档误称 Sundrug 仅有线上店，实际数据库早已存在 1,230 条该品牌记录。旧的精确名称去重未识别“品牌前缀/后缀”差别，曾导致本阶段插入 1,001 条重复记录。发现后，已在检查字段未变、无引用且 ID 不存在于导入前快照的条件下，完整回退这 1,001 条；保留原有记录及关联数据。随后仅对名称与地址确认匹配的 991 条刷新，保留原 ID。

去重现按品牌规范化和分店名称/地址匹配；多候选不会自动选择。原批次余下 10 条身份不明确的记录未插入，其中 2 条随后识别为停业/迁移通知并从当前解析结果排除。

证据：`artifacts/drugstores-import-sundrug-2026-09-13/revert-report.json`、`reconciliation-candidates.json`、`unresolved-identities.json`；刷新核验位于 `artifacts/drugstores-sundrug-refresh-2026-09-13/database-verification.json`。此前包含新增 1,001 条 Sundrug 的总数已失效。

## 复现与质量记录

- SEIMS：`scripts/crawl-seims-directory.mjs`；结果 `artifacts/drugstores-seims-complete-2026-09-13/`；导入 `artifacts/drugstores-import-seims-2026-09-13/`。
- Genky：`scripts/crawl-genky-directory.mjs`；结果 `artifacts/drugstores-genky-complete-2026-09-13/`；导入 `artifacts/drugstores-import-genky-2026-09-13/`。站点漏发中间证书，已将从 GlobalSign 官方获取并验证根签名的中间证书通过 `NODE_EXTRA_CA_CERTS` 提供给 Node；TLS 验证保持开启。证书位于 `artifacts/drugstores-major-next-2026-09-13/globalsign-intermediate.pem`。
- Fit Care：`scripts/crawl-fitcare-ainz.mjs`；结果 `artifacts/drugstores-fitcare-ainz-2026-09-13/`。先入库 33 条，修正无部门标题的零售页面解析后，再新增 43 条；最终 76 条完整核验位于 `artifacts/drugstores-import-fitcare-complete-2026-09-13/`。
- mac：`scripts/crawl-mac-directory.mjs`；结果 `artifacts/drugstores-mac-2026-09-13/`；公开搜索接口返回 count=73，与解析条数一致。拒绝将 Google 地图视窗中心视为门店坐标。
- 实时品牌计数：`artifacts/drugstores-major-next-2026-09-13/database-chain-counts.json`。
- 本阶段 6 个解析与身份回归测试通过；各实际导入批次另有数据库逐字段核验报告。

## 继续范围

尚不能声称主要药妆店全部完成。下一步优先核查 YACS（千叶药品）、アルカ、ヤマザワ药品、ミネ、コメヤ等区域连锁；先对照已有数据库，再枚举官方目录和逐批入库。

Mori、Zagzag、Drug39、Sunroad、Ryuseido 及本表待补项已留有地址目录，后续需可靠坐标或状态证据。已覆盖的集团子品牌不能再次算作空白品牌。

候选范围参考 [日本连锁药妆店协会正会员目录](https://jacds.gr.jp/member-hp/)，该目录也含协会、超市和独立调剂业务，不能直接把全部会员当作本项目缺口。mac 来源为 [官方门店搜索](https://www.daiya-grp.co.jp/store/)。
