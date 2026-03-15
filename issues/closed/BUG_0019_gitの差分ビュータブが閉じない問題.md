#　問題

gitの差分ビューのタブが閉じないことがあります。

# 再現手順

quest_rewardテーブルを開く
quest_rewardの1行目を削除
Ctrl+Sで保存

shop_productテーブルを開く
shop_productの1行目を削除
Ctrl+Sで保存

gitのアイコンをクリック
quest_rewardテーブルをソースコントロールから開く
shop_productテーブルをソースコントロールから開く

quest_rewardテーブルを開く

quest_rewardテーブルをソースコントロールから開く
`差分: quest_reward`タブが2つ存在する

# 期待する動作

`差分: quest_reward`タブはすでに開いているタブをアクティブ化するだけ
