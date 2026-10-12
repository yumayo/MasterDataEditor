---
name: FEAT_0040 全文検索バックグラウンド対応（2026-03-18レビュー）
description: 全文検索のsetTimeout(0)分割処理・searchingクラスによるローディング表示のUXレビュー
type: project
---

## FEAT_0040 全文検索バックグラウンド対応（2026-03-18レビュー）評価: B+

### 実装概要
- テーブルごとに setTimeout(0) でメインスレッドへ制御を返す
- 検索中に .search-panel-results に searching クラスを付与して opacity: 0.5 で半透明化
- transition: opacity 0.1s ease でちらつき防止
- searchRequestId パターンで古いリクエストの結果を破棄（レースコンディション対策）

### DOM確認結果
- 完了後状態: `.search-panel-results` に searching クラスなし（正常）
- 検索中状態: DOMダンプは完了後スナップショットのため searching クラスは観察不可
- テスト: MutationObserver + window.__searchingDetected フラグで「一時的に付与・除去された」を検証
- テスト結果: searching クラスの付与・除去サイクルが確認できた（テストが green）

### 良い点
- searchRequestId パターンが正しく実装されている（二重検索時の古い結果破棄）
- debounce 150ms + setTimeout(0) の組み合わせが理想的（キー入力イベントを受け取った後に制御を返す）
- 空文字入力時に searching クラスを即座に除去するパスが存在する（L207-210）
- transition: opacity 0.1s ease の付与先が .search-panel-results（ローディング状態の要素自身）で適切

### 問題点

#### 致命的
- なし

#### 要改善（🔴）
- なし

#### 改善推奨（🟡）
1. searching クラス付与タイミング問題
   - L205: resultsElement.classList.add('searching') の直後、L207: inputText === '' チェックが来る
   - 空文字チェックで早期リターンする前に searching が付与されるため、空文字削除時に一瞬 opacity:0.5 になる可能性がある
   - 修正案: inputText チェックを searching 付与より前に移動する

2. 検索結果なし状態の表示欠如（FEAT_0038から継続指摘）
   - 検索してヒット0件のとき .search-panel-results が空要素になり、ユーザーは「検索中」「結果なし」「未検索」を区別できない
   - フィルタードロップダウンの `.filter-no-result` と非対称（bug-report #3パターン）

3. search-result-pk にラベルなし（FEAT_0038から継続指摘）
   - `span.search-result-pk` に `title="主キー値"` はあるが、::before で "#" プレフィックスが付くだけ
   - "#1" が「PK値=1の行」だとわかるのは慣れたユーザーのみ

4. aria-live 未設定
   - .search-panel-results に aria-live="polite" がなく、スクリーンリーダーが結果更新を検知できない
   - フィルタードロップダウンと同じ継続課題

5. .search-result-reference-hint の color: #528bff がハードコード（継続指摘）
   - bug-report #116 パターン（ハードコード色）

**Why:** 評価 B+ の理由: 非同期ローディングの核心実装（requestId + transition）は正しいが、空文字チェック順序のバグリスクと結果なし表示の欠如が残る。
**How to apply:** 次回レビューで「searching クラス付与前に空文字チェックが来ているか」を確認すること。
