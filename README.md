# Kevin Wine Portfolio

个人葡萄酒酒窖管理：库存、购买记录、推荐清单与个人品饮追踪。

## 本地运行

```bash
cd /Users/zhuk/Documents/Codex/kevin-wine-portfolio
python3 server.py
```

打开 [http://localhost:5188](http://localhost:5188)。

## Cloudflare 部署

生产版本使用 Cloudflare Workers、静态资源与 D1 数据库。首次部署会从 `seed-targets.json` 自动导入推荐清单。

```bash
npx wrangler d1 create kevin-wine-portfolio
# 将返回的 database_id 写入 wrangler.jsonc
npx wrangler d1 migrations apply kevin-wine-portfolio --remote
npx wrangler deploy
```

## MVP 功能

- 手动添加酒款，支持多用途分类和风格标签
- 手动添加购买记录并自动增加库存
- 在库存列表里用 1-5 颗星记录个人偏好评分
- Dashboard 显示红白比例、用途比例、库存成本和适饮期提醒

## 数据库

SQLite 文件位于：

```text
data/kevin-wine.sqlite
```

首次启动时会自动执行 `schema.sql` 并写入示例数据和 watchlist。删除数据库文件后重启可重新 seed。

## 推荐配置

个人偏好、红白比例、用途目标、预算区间、扣分项都在：

```text
config/recommendation.json
```

推荐引擎读取该配置，避免把 Kevin 的偏好硬编码在函数内部。
