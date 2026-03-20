この状態から

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,2 アイテム,4 かま,1
2,2 アイテム,1 きゅうり,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1

id=1のtable_idを2 → 1に変更

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,1 キャラ,4,1
2,2 アイテム,1 きゅうり,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1

本来はここで、id=1のrecord_idは赤くエラーになっていなければならないのに、何も起きません。
参照はもちろん切れてます。
