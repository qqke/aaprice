# 横滨药妆品牌漏项核查（2026-09-15）

本轮为品牌覆盖审核，没有执行数据库写入。实时只读查询确认横滨 stores 共520条；下列四个品牌的名称/品牌匹配记录均为0。此前495家清单覆盖主要连锁，但存在区域品牌遗漏，不能视作横滨全量。

## 确认的品牌缺口

|品牌|已确认横滨零售门店下限|门店|证据|
|---|---:|---|---|
|ドラッグサカイヤ|5|洋光台駅前、上中里、上永谷ベルセブン、金沢文庫、ユニオン|[官方drugstore分类目录](https://yokohama-sakaiya.co.jp/shop_type/drug/)，目录另列追浜店位于横须贺，不计入横滨|
|湘南薬品|至少3|ラボーテ湘南ラピス店、ラピスドラッグ店、大船グランシップ店|[官方门店及商品目录](https://shonan-yakuhin.co.jp/shop/)，这3家明确同时销售非处方药及化妆品；同页其余横滨药局/化妆品专卖需按业态复核|
|薬ヒグチ|1|反町駅前店，横浜市神奈川区松本町1丁目1-8|[运营方官方门店页](https://www.pharmarise.com/company/store/store.php?store_id=7832)，列为物贩事业部经营|
|オーエスドラッグ|1|横浜店，横浜市西区南幸2-7-8 銀座屋ビル|[エスエス製薬官方销售店目录](https://ssp.storelocator.jp/points/241619)、[旭化成官方销售店目录](https://asahi-kasei.storelocator.jp/points/453234200)、[ツムラ官方销售店目录](https://store-search.tsumura.co.jp/points/657148)；品牌旧官网访问失败，不能声称直接官网抓取成功|

合计至少4个品牌、10家门店。该数量为经官方信息证实的下限，不是完成全市穷尽枚举的结论。需要进一步采集明确店铺坐标、核对门店身份与数据库去重后才可入库。

## 本地专门店及范围边界

- **くすりの大丸**：数据库未匹配。经营者[官网姊妹店页面](https://www.daimaru-kampo.com/info/branch/)与[商店街页面](https://tanmachi-st.com/shop-list/kusuri-daimaru/)可验证，属于汉方/咨询及化妆品零售专门店，可作为本地药店候选，未混入上述连锁计数。
- **灰吹屋**：[官方目录](https://www.haifukiya.com/shop/)所见零售门店位于川崎，未发现可确认的横滨店，不将“神奈川有店”等同“横滨有店”。
- **カツマタ**：和田町店已在2025-05-25改为トモズ；[官方改名公告](https://www.tomods.jp/news_release/shop/25_05_25_200)与[当前门店页](https://shop.tomods.jp/detail/200/)一致。此前已有Tomod's覆盖，不按旧品牌重复添加。大仓山店亦已有Tomod's名称。
- **ミネ**：旧日吉駅前店在2025-05-20关闭并并入日吉店；[官方公告](https://www.mineiyakuhin.co.jp/news/ミネ薬局日吉駅前店-店舗統合のお知らせ/)。[当前目录](https://www.mineiyakuhin.co.jp/store/)横滨门店标为ミネ薬局，尚无足够证据纳入本次零售药妆缺口。
- **ミュゼ・ド・ポゥ等化妆品专卖**：与纯调剂药局一样需要单独定义范围，不能直接与药妆零售链相加。

## 已覆盖与品牌名称差异

第三方[横滨连锁分类目录](https://pharmacy.geomedian.com/area/yokohama/)可用于发现候选，但没有列全サカイヤ、湘南薬品、薬ヒグチ，因此不能用单一聚合目录判断“品牌已齐”。此前松本清系64家包含matsukiyoLAB；ココカラ系22家包含セイジョー；Fit Care56家含DEPOT/Express/MART，不应因展示品牌名不同重复添加。

此前Ainz还有4家待核查，是已覆盖品牌的门店缺口，不是遗漏品牌。本轮没有改变此前已入库495家或待核查4家的状态。

数据库查询证据：`artifacts/drugstores-yokohama-brand-audit-2026-09-15/database-check.json`。
