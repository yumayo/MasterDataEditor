#　問題

gitの差分ビューで複数ファイル編集している時、タブごとに差分ビューが管理されていないです
これ色々と不具合が出ているので念入りに調べてもらっていいですか？
差分ビューだけではなく、通常のエクスプローラーからテーブルを開いたときも差分テーブルが表示されています。

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

差分: shop_product というタブなのにも関わらず、quest_rewardテーブルも表示されている

# 期待する動作

差分: shop_product タブの中身はshop_productテーブルのみとなっている
