#　問題

RelationsパネルでN:1のミニテーブルだけデータ追加用の空行が表示されていないです。
この空行が表示されていないと、新しい報酬グループを設定するときに、ミニテーブルでデータを入稿できないため困ります。

# 再現手順

questテーブルを開く

右ペインは以下のように表示される

table
,id,enum,comment,master
1,1,chara,キャラ,chara

chara
,id,recover_stamina,recover_hp,attack,defence,speed,skill_id,selling_price
1,3 まんぼう,,,,,,2 攻撃力5上昇,

quest_reward
,id,group_id,reward_table_id,reward_record_id
1,1,1,1 キャラ,1 うーぱーるーぱー
2,1,1,2 アイテム,2 とげとげのきゅうり

# 期待する動作

右ペインは以下のように表示される

table
,id,enum,comment,master
1,1,chara,キャラ,chara
2,,,, (空行)

chara
,id,recover_stamina,recover_hp,attack,defence,speed,skill_id,selling_price
1,3 まんぼう,,,,,,2 攻撃力5上昇,
2,,,,,,,, (空行)

quest_reward
,id,group_id,reward_table_id,reward_record_id
1,1,1,1 キャラ,1 うーぱーるーぱー
2,1,1,2 アイテム,2 とげとげのきゅうり
3,,,, (空行)
