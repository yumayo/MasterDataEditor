import { Page } from '@playwright/test';

/**
 * インメモリファイルシステム
 * キーはファイルパス、値はファイル内容の文字列
 */
export interface MockFileSystem {
    [path: string]: string;
}

/**
 * ファイル一覧の要素
 */
interface MockFile {
    name: string;
    type: 'file' | 'directory';
}

/**
 * テスト用のデフォルトファイルシステムを生成する
 */
export function createDefaultFileSystem(): MockFileSystem {
    const schema = JSON.stringify({
        header: [
            { key: 0, name: "id", type: "int" },
            { key: 1, name: "name", type: "string" },
            { key: 2, name: "value", type: "int" },
        ],
        primary_key: "id",
    });

    const csv = [
        "id,name,value",
        "1,item_a,100",
        "2,item_b,200",
        "3,item_c,300",
    ].join("\n");

    return {
        "schema/test.json": schema,
        "data/test.csv": csv,
    };
}

/**
 * window.chrome.webview をモックに差し替える
 *
 * page.addInitScript でブラウザコンテキストに注入し、
 * C#バックエンドのファイルI/Oをインメモリで再現する。
 */
export async function installMockApiAsync(
    page: Page,
    fileSystem: MockFileSystem,
): Promise<void> {
    await page.addInitScript(
        (fs: MockFileSystem) => {
            type Handler = (event: MessageEvent) => void;

            const listeners: Handler[] = [];

            /**
             * ディレクトリ内のファイル一覧を返す
             */
            function findFiles(directory: string): MockFile[] {
                const prefix = directory + "/";
                const seen = new Set<string>();
                const results: MockFile[] = [];

                for (const key of Object.keys(fs)) {
                    if (!key.startsWith(prefix)) {
                        continue;
                    }
                    const rest = key.substring(prefix.length);
                    const slashIndex = rest.indexOf("/");

                    if (slashIndex === -1) {
                        // ファイル
                        if (!seen.has(rest)) {
                            seen.add(rest);
                            results.push({ name: rest, type: "file" });
                        }
                    } else {
                        // サブディレクトリ
                        const dirName = rest.substring(0, slashIndex);
                        if (!seen.has(dirName)) {
                            seen.add(dirName);
                            results.push({
                                name: dirName, type: "directory",
                            });
                        }
                    }
                }

                const hasPrefix =
                    Object.keys(fs).some(k => k.startsWith(prefix));
                if (results.length === 0 && !hasPrefix) {
                    throw new Error(
                        `Directory not found: ` + directory,
                    );
                }

                return results;
            }

            /**
             * レスポンスメッセージを配信する
             */
            function dispatch(data: object): void {
                const event = new MessageEvent(
                    "message", { data: JSON.stringify(data) },
                );
                for (let i = 0; i < listeners.length; ++i) {
                    listeners[i](event);
                }
            }

            /**
             * リクエストを処理してレスポンスを返す
             */
            function handleRequest(message: string): void {
                const request = JSON.parse(message);
                const type = request.type as string;

                if (type === "find_files_request") {
                    try {
                        const files = findFiles(request.directory);
                        dispatch({
                            type: "find_files_response",
                            success: true,
                            data: files,
                        });
                    } catch (e: unknown) {
                        const msg = e instanceof Error
                            ? e.message : String(e);
                        dispatch({
                            type: "find_files_response",
                            success: false,
                            error: msg,
                        });
                    }
                    return;
                }

                if (type === "read_file_request") {
                    const filename = request.filename as string;
                    if (filename in fs) {
                        dispatch({
                            type: "read_file_response",
                            success: true,
                            data: fs[filename],
                        });
                    } else {
                        dispatch({
                            type: "read_file_response",
                            success: false,
                            error: "File not found: " + filename,
                        });
                    }
                    return;
                }

                if (type === "write_file_request") {
                    const filename = request.filename as string;
                    const data = request.data as string;
                    fs[filename] = data;
                    dispatch({
                        type: "write_file_response",
                        success: true,
                    });
                    return;
                }
            }

            window.chrome = {
                webview: {
                    postMessage(message: string | object): void {
                        const raw = typeof message === "string"
                            ? message : JSON.stringify(message);
                        // 非同期でレスポンスを返す
                        setTimeout(() => handleRequest(raw), 0);
                    },
                    addEventListener(
                        _event: "message", handler: Handler,
                    ): void {
                        listeners.push(handler);
                    },
                    removeEventListener(
                        _event: "message", handler: Handler,
                    ): void {
                        const index = listeners.indexOf(handler);
                        if (index !== -1) {
                            listeners.splice(index, 1);
                        }
                    },
                },
            };
        },
        fileSystem,
    );
}
