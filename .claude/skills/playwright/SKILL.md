---
description: playwrightでテストを実行する
---

## 重要

playwrightコンテナと通信できなければすぐに作業を中断してください。  
playwrightコンテナでテストすることが重要でこのスキルを使用しているため、このまま続行してもユーザーが求めていることが実現できません。

## すべてのテストを実行する

BAD
```sh
npm playwright test
```

```sh
docker compose exec playwright npx playwright test
```

## 特定のテストのみ実行する

BAD
```sh
npm playwright test column-insert
```

GOOD
```sh
docker compose exec playwright npx playwright test column-insert
```
