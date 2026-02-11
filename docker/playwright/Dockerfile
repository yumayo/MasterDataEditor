FROM node:22-bookworm

WORKDIR /app/WebView

# package.json を先にコピーして依存をインストール
COPY WebView/package.json ./
RUN npm install

# npm install で解決された @playwright/test と
# 同じバージョンの Chromium をインストール
RUN npx playwright install --with-deps chromium

# Vite dev serverが参照する環境変数を設定
RUN echo 'MASTER_DATA_EDITOR_DEV_PORT=5173' \
    > /app/.env

# テスト用config.jsonを配置
COPY WebView/e2e/fixtures/config.json \
    /app/WebView/src/config.json

ENTRYPOINT ["npx", "playwright"]
