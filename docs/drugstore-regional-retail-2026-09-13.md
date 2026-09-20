# 日本药妆目录续采（2026-09-13）

> 后续状态：本批58条已于2026-09-13入库，与スギヤマ104条合并为162条；数据库逐条验证缺失0、不一致0。实际执行记录见 `artifacts/drugstores-import-next-2026-09-13/import-report.json` 及 `database-verification.json`。下文“未执行”描述的是原始采集阶段。

参考既有报告与原始 stores.json 后，补采此前未接入的大賀薬局集团和エバグリーン。范围仍为实体门店目录，本批未采商品价格，未执行数据库写入。

| 官方目录 | 发现 | 通过地址与坐标验证 | 待核查 |
|---|---:|---:|---:|
| 大賀薬局（含グリーンドラッグ） | 22 | 20 | 2 |
| エバグリーン、スーパーエバグリーン | 39 | 38 | 1 |
| 合计 | 61 | 58 | 3 |

大賀按官网“ドラッグストア”分类遍历两页，与官方“全22件”核对一致，排除调剂专门分类。坐标取官网导航 destination。エバグリーン遍历两个官方品牌目录及39个详情页，坐标取嵌入地图的 place 查询值，不使用地图视图中心；不包括廣岡集团其他超市品牌。

58条与12份既有门店结果比对，ID及标准化名称＋地址均无精确重复。该检查针对本地结果，未查询实时数据库，不能作为数据库净增数。原始响应和采集时间保存在 cache，可离线重放。

待核查：大賀薬局薬院大通り店含8月10、11日临时休业公告，公告缺年份，保守保留；ファミリーマート ドラッグ大賀野芥店官网导航坐标为空；スーパーエバグリーンプラス上富田店的官方地址缺县名。均不进入本批SQL。

## 修正此前缺口清单

`artifacts/drugstores-2026-09-10/stores.json` 已包含ウェルパーク138、コクミン163、ダックス75、よどやドラッグ25、ふく薬品22、ハックドラッグ162、ププレひまわり122条；这些是旧批次数据量，不是今日实时门店总数。它们不应再被列为完全未覆盖品牌。Welpark、Kokumin官网的门店链接现在指向Welcia集团目录。

SEIMS官网公开前端包含 `/api/point/` 请求，但本次无参数、地图边界和文字查询均返回404，尚未获得有效门店数据，不能标记采集完成。该探测缓存保存在 `artifacts/drugstores-expansion-2026-09-13/cache/`（成功响应）；失败请求结论记录于本文。

## 复现与产物

运行 `node scripts/crawl-regional-retail.mjs --resume`，离线复现用 `--offline`；全新采集用 `--out=新的目录`。沿用已有fetcher的robots检查、每源至少1秒请求间隔、超时和原始响应缓存。

输出位于 `artifacts/drugstores-regional-retail-2026-09-13/`：`stores.json`、`pending.json`、`report.json`、`duplicate-check.json`、`import.sql`。SQL已生成但未执行。

`node --test tests/regional-retail.test.mjs` 两项通过，覆盖零售分类、缺坐标、关闭公告、坐标空格、注释旧门店排除及拒绝视图中心；全目录离线重放成功。

官方来源：[大賀药局门店检索](https://www.ohga-ph.com/search/)、[大賀药局零售目录](https://www.ohga-ph.com/shop/?store_type%5B%5D=3)、[エバグリーン](https://hirooka-g.co.jp/store/store_evergreen/)、[スーパーエバグリーン](https://hirooka-g.co.jp/store/store_superevergreen/)。
