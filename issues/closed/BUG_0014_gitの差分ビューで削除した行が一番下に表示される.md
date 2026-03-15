#　問題

gitの差分ビューで削除した行が一番下に表示されています。
削除した場所を維持して表示したいです。

# 再現手順

quest_rewardテーブルを開く
quest_rewardの1行目を削除
Ctrl+Sで保存
gitのアイコンをクリック
quest_rewardテーブルをソースコントロールから開く

以下のように表示される
id,group_id,reward_table_id,reward_record_id
2,1,2,2
3,2,1,2
4,3,2,5
1,1,1,1 (赤色)

# 期待する動作

以下のように表示される
id,group_id,reward_table_id,reward_record_id
1,1,1,1 (赤色)
2,1,2,2
3,2,1,2
4,3,2,5
