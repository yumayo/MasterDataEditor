FROM node:24-bookworm

# .NET SDK のインストール
# https://learn.microsoft.com/dotnet/core/install/linux-debian
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget apt-transport-https \
    && wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh \
    && chmod +x /tmp/dotnet-install.sh \
    && /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet \
    && rm /tmp/dotnet-install.sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1

RUN mkdir -p /app && chown -R node:node /app
WORKDIR /app

# C# ソースをコピー（WPFビルドが一時ファイルを書くためマウントではなくCOPY）
COPY --chown=node:node App.MasterDataEditor/ ./App.MasterDataEditor/
COPY --chown=node:node App.MasterDataEditor.sln ./

# C# 依存パッケージの復元
RUN dotnet restore App.MasterDataEditor/App.MasterDataEditor.csproj

# WebView の依存をインストール
COPY --chown=node:node WebView/package.json WebView/package-lock.json ./WebView/
RUN cd WebView && npm ci

USER node
