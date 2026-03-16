#　問題

gitの差分ビューのパディング行が保存されてしまいます。
本来は比較を行うために表示領域を調整するためのものであって、保存対象ではありません。

# 再現手順

quest_rewardテーブルを開く
1行目を削除
Ctrl+Sで保存

gitのアイコンをクリック
quest_rewardテーブルをソースコントロールから開く
右ペインのquest_rewardテーブルの行ヘッダー4をクリックする。
下に行を挿入
新しく作成された行ヘッダー5の行に、5,1,1,1と入力する
Ctrl+Sで保存

quest_reward.csvが以下のように出力される

id,group_id,reward_table_id,reward_record_id
,,,
2,1,2,2
3,2,1,2
4,3,2,5
5,4,1,1

この時Dirtyフラグが消えないです。 (保存はできているのでフラグ管理の問題です。)

quest_rewardタブ (差分ではない) を開く

追加して保存しているはずのid=5のデータが表示されていない (タブを閉じてからエクスプローラーで開くと正しく挿入されています)

id,group_id,reward_table_id,reward_record_id
2,1,2,2
3,2,1,2
4,3,2,5

# 期待する動作

quest_reward.csvは以下のように出力される

id,group_id,reward_table_id,reward_record_id
2,1,2,2
3,2,1,2
4,3,2,5
5,4,1,1

この時Dirtyフラグが消える。

quest_rewrdタブを開く

追加して保存しているはずのid=5のデータが表示されている

id,group_id,reward_table_id,reward_record_id
2,1,2,2
3,2,1,2
4,3,2,5
5,4,1,1
