// キャラクターのバランスチェック
for (const chara of tables.chara.all()) {
    if (chara.attack === '' || chara.defence === '') continue;
    const total = Number(chara.attack) + Number(chara.defence);
    assert(total < 10, `chara id=${chara.id}: 攻撃力(${chara.attack})と防御力(${chara.defence})の合計値${total}が100以上です`);
}
