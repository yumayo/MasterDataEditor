FROM node:24-bookworm

RUN mkdir -p /app/WebView && chown -R node:node /app
WORKDIR /app/WebView

# package.json を先にコピーして依存をインストール（nodeユーザー）
COPY --chown=node:node WebView/package.json ./
USER node
RUN npm install

# システム依存パッケージとlsofのインストールはrootで実行
USER root
RUN npx playwright install --with-deps chromium \
    && apt-get install -y --no-install-recommends lsof \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.cache/ms-playwright

# ブラウザ本体はnodeユーザーでインストール
USER node
RUN npx playwright install chromium

# Vite dev serverが参照する環境変数を設定
RUN echo 'MASTER_DATA_EDITOR_DEV_PORT=5173' > /app/.env

# テスト用config.jsonを配置
COPY --chown=node:node WebView/e2e/fixtures/config.json /app/WebView/src/config.json

# テスト結果用のディレクトリを作成しておきます。
RUN mkdir -p ./test-results && chown node:node ./test-results

USER node
