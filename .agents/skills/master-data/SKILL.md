---
name: master-data
description: マスターデータ開発スキル。
---

# マスターデータとは

マスターデータはソーシャルゲームのエネミーやイベント、アイテムなどの情報をもったデータ群です。
実データはcsvファイルで、スキーマはjsonファイルで定義しています。

## 実データ(csv)

- headerあり
- comma(,)区切りです。

## スキーマ(json)

```json
{
  "type": "object",
  "required": ["header"],
  "additionalProperties": false,
  "properties": {
    "description": {
      "type": "string"
    },
    "header": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "name", "type"],
        "additionalProperties": false,
        "properties": {
          "key": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "type": {
            "type": "string"
          },
          "comment": {
            "type": "string"
          },
          "reference": {
            "type": "string"
          }
        }
      }
    },
    "primary_key": {
      "type": "string"
    },
    "uniqyue_key": {
      "type": "string"
    },
    "index": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```
