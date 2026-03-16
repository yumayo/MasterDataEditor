# 問題

.CONTEXT/issues/BUG_0024_image.png を見てください。

右ペインのミニテーブルの「N:1」バッチがあると思いますが、これのFK名とFK値が表示されていないです。
1:Nの方は表示されています。

# 再現手順

quest_rewardテーブルを開く

右ペインのRelationsパネルのtableミニテーブルと、charaミニテーブルのN:1バッチの右にFK名とFK値が表示されていないです。

# 期待する動作

quest_rewardテーブルを開く

右ペインのRelationsパネルには、
table[N:1][reward_table_id=1]
chara[N:1][reward_record_id=1]
と表示される。
