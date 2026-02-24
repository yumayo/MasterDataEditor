---
description: TDD テスト駆動開発を行うためのスキルです。実装するときには必ず使用すること。
---

以下のxmlの手順でTDDで実装を行ってください。

<Workflow>

  <Task id="1">
    TDDサイクル設計テストファースト戦略を使用してテストケースのみを実装 WebView/e2e/*.spec.ts
  </Task>

  <Task id="2">
    `cd WebView && npx tsc --noEmit && cd ..` でコンパイルチェック
  </Task>

  <Task id="3">
    `playwrightスキル` でテストをして RED になることを確認する。
  </Task>

  <Task id="4">
    ガイドラインを準拠しながら実装を行います。
  </Task>

  <Task id="5">
    `playwrightスキル` でテストをして GREEN になることを確認する。
    RED であればTask.id=4の工程に戻る。
  </Task>

  <Task id="6">
    `code-reviewerサブエージェント` にチェックしてもらう。
    指摘があれば修正し、Task.id=4の工程に戻る。
  </Task>

  <Task id="7">
    `commitスキル` で変更点をコミットする。
  </Task>

</Workflow>
