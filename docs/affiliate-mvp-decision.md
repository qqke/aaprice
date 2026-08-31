# 联盟导流 MVP 决策

## 决策

首期选择 **楽天アフィリエイト / 楽天市場**，以 50 个高访问且有 JAN 码的商品做人工审核链接试点。

楽天商品価格ナビ API 支持用 JAN（`productCode`）查找产品；传入 affiliate ID 时会返回 affiliate URL，适合 AAPRICE 现有的商品标识方式。楽天市场商品搜索 API 还提供售价、库存状态、店铺和佣金率字段，后续可在服务端同步。[产品搜索 API](https://webservice.rakuten.co.jp/documentation/ichiba-product-search) · [商品搜索 API](https://webservice.rakuten.co.jp/documentation/ichiba-item-search)

## MVP 边界

- 第一阶段由管理员录入并审核 50 个联盟链接，不在静态前端保存 access key 或 affiliate ID。
- 商品页和比价清单只在存在启用链接时显示“合作购买”，并明确标注商业关系。
- 点击先写入匿名 session、入口和 offer ID，再跳转到合作方；不保存搜索词、地址或精确位置。
- 商品名称、功效描述和推荐文案不因佣金排序；医药品及健康商品文案遵守楽天联盟指南及药机法提示。[楽天アフィリエイト指南](https://affiliate.rakuten.co.jp/guideline/rule/)
- 试点成功标准：覆盖 50 个热门商品，符合条件会话的商业出口点击率 ≥ 8%，且没有影响查价行动率。

## 暂不实施

- 浏览器直接调用楽天 API
- 自动选择最高佣金商品
- 多联盟平台统一抽象
- 成交回调和收入核算（获得合作方回调能力后再做）

## 上线前外部事项

1. 注册并通过楽天 Web Service 与联盟账号审核。
2. 确认网站展示、价格更新、图片使用和链接标注符合最新条款。
3. 获取首批 affiliate URL，并在后台人工启用。
