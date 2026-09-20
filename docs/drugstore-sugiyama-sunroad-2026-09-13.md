# 日本药妆目录续采：スギヤマ薬品、サンロード

> 后续状态：スギヤマ104条已于2026-09-13入库，与上一批58条合并为162条；数据库逐条验证缺失0、不一致0。サンロード43条仍待坐标，未入库。执行记录见 `artifacts/drugstores-import-next-2026-09-13/`。下文“未执行”描述的是原始采集阶段。

本批继续采集官方实体门店目录。未采商品价格，未执行数据库写入。

| 来源 | 目录记录 | 验证通过 | 待坐标 | 排除 |
|---|---:|---:|---:|---:|
| スギヤマ薬品 | 125 | 104 | 1 | 20 |
| クスリのサンロード | 43 | 0 | 43 | 0 |

スギヤマ125个详情页全部抓取完成，请求失败0。19家调剂专门店和1家标注“近日オープン”的各務原店排除；豊橋中浜店仅提供地址型地图和视图中心，暂不导入。104家坐标取官方地图中明确的度分秒坐标标签，不取视图中心；缺省县名按官网URL中的爱知、岐阜、三重分类补齐，并保留来源说明。スギヤマ薬品与已采集的スギ薬局是不同来源。

サンロード仅采官网“ドラッグストア”区段的43条零售店记录，已保存名称、完整地址、电话和营业时间。官网没有门店坐标，因此全部保存在pending.json，不放入stores.json，不生成含这些记录的入库SQL；同页调剂药局、餐厅、温泉、健身房不计入零售数量。

104条通过验证的记录已与此前本地stores.json按ID、标准化名称＋地址核对，没有精确重复。这不是实时数据库去重结果，也不是数据库净增数。

## 覆盖清单核查

`artifacts/drugstores-national-extra-2026-09-12/stores.json` 已有59条“クスリ岩崎チェーン”，不能再将其视为完全未覆盖。本次还核查了龍生堂官方目录入口；它尚未在本批完成采集。SEIMS、未完成的Genky/Sundrug及缺坐标目录仍需后续工作，不能称为全国全量完成。

## 产物与验证

- `scripts/crawl-sugiyama.mjs`：支持 `--resume`、`--offline` 和 `--out=新目录`。
- `scripts/crawl-sunroad.mjs`：相同参数，保留无坐标目录。
- `artifacts/drugstores-sugiyama-2026-09-13/`：stores.json、pending.json、excluded.json、report.json、duplicate-check.json、import.sql及原始响应缓存。SQL未执行。
- `artifacts/drugstores-sunroad-2026-09-13/`：43条pending.json、空stores.json、report.json及缓存。
- `tests/sugiyama-sunroad.test.mjs` 两项测试通过，覆盖坐标标签与视图中心区分、县名来源、未开业及调剂排除、正常定休日识别、零售区段限制、注释旧数据排除。两个爬虫离线重放成功，`git diff --check`通过。

官方来源：[スギヤマ药品目录](https://sugiyama-club.jp/shop/list.html)、[サンロード目录](https://www.kusurinosunroad.com/store.php#p2)、[龍生堂目录](https://www.ryuseido.co.jp/shop/index.html)。
