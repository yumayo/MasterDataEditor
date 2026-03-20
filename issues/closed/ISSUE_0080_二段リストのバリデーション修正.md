この状態から

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,1 キャラ,3 まんぼう,1
2,2 アイテム,5 尖ったかま,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1

id=2のtable_idを2 → 1に変更

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,1 キャラ,3 まんぼう,1
2,1 キャラ,5,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1

本来はここで、id=2のrecord_idは赤くエラーになっていなければならないのに、何も起きません。
参照はもちろん切れてます。


この不具合と同じかわかりませんが、他の手順で変わらないケースがあります。

この状態から

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,1 キャラ,3 まんぼう,1
2,2 アイテム,5 尖ったかま,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1

id=1のtable_idを削除

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,,3,1
2,2 アイテム,5 尖ったかま,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1

この状態でrecord_idに赤波線が引かれないといけません。
ただ、更に変なのがここからid=1のtable_idに3を代入すると、table_idの参照が無いにも関わらずエラーにもなりません。

id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id
1,3,3,1
2,2 アイテム,5 尖ったかま,1
3,1 キャラ,3 まんぼう,2
4,1 キャラ,3 まんぼう,1
