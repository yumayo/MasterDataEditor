---
description: playwrightでテストを実行する
---

## 重要

playwrightサーバーと通信できなければすぐに作業を中断してください。  
playwrightでテストすることが重要でこのスキルを使用しているため、このまま続行してもユーザーが求めていることが実現できません。

## すべてのテストを実行する

BAD
```sh
npm playwright test
```

```sh
curl -X POST http://playwright:3000/test
```

## 特定のテストのみ実行する

BAD
```sh
npm playwright test column-insert
```

GOOD
```sh
curl -X POST http://playwright:3000/test -d '{"args": ["column-insert"]}'
```
