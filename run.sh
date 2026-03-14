#!/bin/bash

# issues/open/ から BUG_* / FEAT_* の課題を1つずつ取得し、
# claude に渡して処理させるループスクリプト。
# 最大50ループで打ち切り。

# ログ出力: 画面とファイルの両方に出力する
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/run_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

ISSUES_OPEN_DIR="issues/open"
ISSUES_CLOSED_DIR="issues/closed"
MAX_LOOPS=2

loop_count=0

while [ "$loop_count" -lt "$MAX_LOOPS" ]; do
    # issues/open/ から最初の BUG_* または FEAT_* ファイルを1つ取得
    issue_file=$(find "$ISSUES_OPEN_DIR" -maxdepth 1 -type f \( -name 'BUG_*' -o -name 'FEAT_*' \) | sort | head -n 1)

    # ファイルが無ければ終了
    if [ -z "$issue_file" ]; then
        echo "処理すべき課題がありません。終了します。"
        break
    fi

    loop_count=$((loop_count + 1))
    echo "=== ループ ${loop_count}/${MAX_LOOPS}: ${issue_file} を処理中 ==="

    # claude に課題ファイルを渡して実行
    claude --dangerously-skip-permissions \
        --disallowedTools "WebSearch,WebFetch" \
        -p "/orchestrator ${issue_file}"

    # claude プロセス終了後、課題ファイルを closed に移動
    mv "$issue_file" "$ISSUES_CLOSED_DIR/"
    echo "=== ${issue_file} を ${ISSUES_CLOSED_DIR}/ に移動しました ==="

    claude --dangerously-skip-permissions \
        --disallowedTools "WebSearch,WebFetch" \
        -p "/commit"
done

if [ "$loop_count" -ge "$MAX_LOOPS" ]; then
    echo "最大ループ回数(${MAX_LOOPS})に達しました。終了します。"
fi
