#!/bin/bash
# planファイルに実装手順ヘッダーを加筆するフック

STDIN_DATA=$(cat)

# stdinのJSONからファイルパスとツール名をパース
FILE_PATH=$(echo "$STDIN_DATA" | jq -r '.tool_input.file_path')
TOOL_NAME=$(echo "$STDIN_DATA" | jq -r '.tool_name')

# Writeツールのファイルパスがplanディレクトリ内かチェック
if [[ "$FILE_PATH" != /home/ubuntu/.claude/plans/* ]]; then
  exit 0
fi

# すでにヘッダーが存在する場合はスキップ
if grep -q "## 実装手順のコンテキスト" "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

read -r -d '' HEADER << 'HEADER_EOF'
## 実装手順のコンテキスト

まず、**orchestrator** スキルを読んでください。
あなたは **orchestrator** スキルを使用して、エージェントを活用してください。これが何より重要で、しないとトークンが制限に達しcompactionしなければならないことが多々あります。
まず関連ファイルの確認は、**bug-diagnosis-coordinator** エージェントにゆだねてください。
その結果を用いて、**typescript-tdd-developer** エージェントに実装を任せること。
TDDで開発しますので、まずはREDとなるテストを**typescript-tdd-developer** に実装してもらってください。
REDとなるテストの実装が完了したら、**playwright-test-reporter** エージェントにテストをしてもらいユーザーが言っていることを確認してください。
再現することを確認後、再び **typescript-tdd-developer** エージェントに実装依頼してください。
あなたは再び **playwright-test-reporter** エージェントにテストをしてもらい GREEN となることを確認してもらってください。
もし、問題があればフィードバックループしてください。
テストが通れば、**fix-scope-auditor** エージェント、**adversarial-code-reviewer** エージェント、**code-reviewer** エージェントに並列でコードレビューしてもらってください。
もし、問題があればフィードバックループしてください。
最後に、**playwright-test-reporter** スキルで全テストがGREENになっていることを確認し、エンバグがないことをチェックしてください。
問題がなければ、**commit** スキルを使用して、変更内容をコミットしてください。
HEADER_EOF

TMPFILE=$(mktemp)
# H1行を読み取り、その後にヘッダーを挿入する
{
  head -1 "$FILE_PATH"
  printf '\n%s\n\n' "$HEADER"
  tail -n +3 "$FILE_PATH"
} > "$TMPFILE"
mv "$TMPFILE" "$FILE_PATH"
