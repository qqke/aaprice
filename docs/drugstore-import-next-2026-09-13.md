# 分步执行：入库，再采集龍生堂

## 第一步：162条已验证门店入库完成

读取实时数据库全量门店快照，按ID及标准化名称＋地址核对后，大賀/エバグリーン58条与スギヤマ104条全部通过，162条均为新ID，无重复排除。复用现有事务SQL导入，数据库记录数由18,113增至18,275。

导入后逐条验证162条的名称、连锁、地址、县名、经纬度、营业时间：缺失0、不一致0。该总数沿用既有stores表口径，包含先前线上来源记录，不代表纯实体门店全国总数。未写入无可靠坐标的记录，也没有商品价格写入。

执行证据位于 `artifacts/drugstores-import-next-2026-09-13/`：

- `database-before.json`：实际入库前快照。
- `stores.json`、`import.sql`：本批导入数据及SQL。
- `import-report.json`：applied=true、净增162条。
- `database-verification.json`：checked=162、missing=0、mismatched=0。

导入器和验证器新增`--out=目录`，避免覆盖旧批次报告；导入器每次读取实时数据库快照，不再依赖旧批次快照。执行命令使用`node --env-file=.env`加载既有数据库配置，凭据不写入报告。

## 第二步：龍生堂目录完成，暂不入库

从[龍生堂官方目录](https://www.ryuseido.co.jp/shop/index.html)枚举26个详情页，全部完成，无请求或解析失败。排除永山調剤店1条；25条待核查，其中24条缺可靠坐标，APii COSMETICS 1条待确认药妆零售分类。地图视图中心不作为门店坐标。地址按官网表格中的東京都、神奈川県、埼玉県分组补齐，保留详情页营业时间及原始响应。

产物：`scripts/crawl-ryuseido.mjs` 与 `artifacts/drugstores-ryuseido-2026-09-13/`。stores.json为空，pending.json有25条，excluded.json有1条；本批未执行入库。

相关5项解析测试通过，龍生堂全目录离线重放通过，`git diff --check`通过。本轮采集已结束，无后台运行任务。
