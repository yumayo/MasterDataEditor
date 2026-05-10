import type { Page } from '@playwright/test';

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
        primary_key: ["id"],
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
        "userdata/bookmarks.json": "[]",
        "plugins/.gitkeep": "",
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
    const mockFsInstanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await page.addInitScript(
        ({ fs, instanceId }: { fs: MockFileSystem; instanceId: string }) => {
            type Handler = (event: MessageEvent) => void;
            type AfterWriteHook = (filename: string, data: string) => void;
            type MockApiWindow = {
                __mockFs: MockFileSystem;
                __mockApiRequests: string[];
                __mockApiRequestDetails: Array<{ type: string; filename?: string }>;
                __onAfterWriteFile?: AfterWriteHook;
            };
            const MOCK_FS_STORAGE_KEY = '__mockFs';
            const MOCK_FS_INSTANCE_KEY = '__mockFsInstanceId';
            const storedFs = sessionStorage.getItem(MOCK_FS_STORAGE_KEY);
            const storedInstanceId = sessionStorage.getItem(MOCK_FS_INSTANCE_KEY);
            const runtimeFs = storedFs !== null && storedInstanceId === instanceId
                ? JSON.parse(storedFs) as MockFileSystem
                : fs;

            function persistMockFs(): void {
                sessionStorage.setItem(MOCK_FS_STORAGE_KEY, JSON.stringify(runtimeFs));
                sessionStorage.setItem(MOCK_FS_INSTANCE_KEY, instanceId);
            }

            function serializeWriteFileData(data: unknown): string {
                if (typeof data === "string") {
                    return data;
                }
                const json = JSON.stringify(data, null, 4);
                if (json === undefined) {
                    throw new Error("Cannot stringify write_file data as JSON");
                }
                return json.replace(/\r\n?/g, "\n") + "\n";
            }

            const listeners: Handler[] = [];

            /**
             * ディレクトリ内のファイル一覧を返す
             */
            function findFiles(directory: string): MockFile[] {
                const prefix = directory + "/";
                const seen = new Set<string>();
                const results: MockFile[] = [];

                for (const key of Object.keys(runtimeFs)) {
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
                    Object.keys(runtimeFs).some(k => k.startsWith(prefix));
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
            // テストからMockFileSystemを参照可能にする（readMockFileAsync経由でアクセス）
            (window as unknown as MockApiWindow).__mockFs = runtimeFs;
            (window as unknown as MockApiWindow).__mockApiRequests = [];
            (window as unknown as MockApiWindow).__mockApiRequestDetails = [];
            persistMockFs();

            function handleRequest(message: string): void {
                const request = JSON.parse(message);
                const type = request.type as string;
                (window as unknown as MockApiWindow).__mockApiRequests.push(type);
                (window as unknown as MockApiWindow).__mockApiRequestDetails.push({
                    type,
                    filename: typeof request.filename === "string" ? request.filename as string : undefined,
                });
                // リクエストIDをレスポンスにエコーバックする（並列リクエストの照合用）
                const requestId = request.requestId as string | undefined;

                // editor_api_request は C# → WebView の逆方向通信。
                // ブリッジが addEventListener で登録したリスナーに配信する。
                if (type === "editor_api_request") {
                    dispatch(request);
                    return;
                }

                // editor_api_response はブリッジが postMessage で送信した C# 向けレスポンス。
                // テスト環境ではリスナーに配信してテストが受信できるようにする。
                if (type === "editor_api_response") {
                    dispatch(request);
                    return;
                }

                // file_changed は C# の FileSystemWatcher からのプッシュ通知。
                // そのまま全リスナーに配信する。
                if (type === "file_changed") {
                    dispatch({ type: "file_changed" });
                    return;
                }

                if (type === "find_files_request") {
                    try {
                        const files = findFiles(request.directory);
                        dispatch({
                            type: "find_files_response",
                            requestId,
                            success: true,
                            data: files,
                        });
                    } catch (e: unknown) {
                        const msg = e instanceof Error
                            ? e.message : String(e);
                        dispatch({
                            type: "find_files_response",
                            requestId,
                            success: false,
                            error: msg,
                        });
                    }
                    return;
                }

                if (type === "read_file_request") {
                    const filename = request.filename as string;
                    if (filename in runtimeFs) {
                        dispatch({
                            type: "read_file_response",
                            requestId,
                            success: true,
                            data: runtimeFs[filename],
                        });
                    } else {
                        dispatch({
                            type: "read_file_response",
                            requestId,
                            success: false,
                            error: "File not found: " + filename,
                        });
                    }
                    return;
                }

                if (type === "write_file_request") {
                    const filename = request.filename as string;
                    const data = serializeWriteFileData(request.data);
                    const mockWindow = window as unknown as MockApiWindow;
                    runtimeFs[filename] = data;
                    persistMockFs();
                    dispatch({
                        type: "write_file_response",
                        requestId,
                        success: true,
                    });
                    // ファイル書き込み後フック: テストから登録することで保存後の状態を動的に変更できる
                    const hook = mockWindow.__onAfterWriteFile;
                    if (hook) { hook(filename, data); }
                    return;
                }

                if (type === "delete_file_request") {
                    const filename = request.filename as string;
                    if (filename in runtimeFs) {
                        delete runtimeFs[filename];
                        persistMockFs();
                        dispatch({ type: "delete_file_response", requestId, success: true });
                    } else {
                        dispatch({ type: "delete_file_response", requestId, success: false, error: "File not found" });
                    }
                    return;
                }

                // git差分機能: 変更/ステージ済みファイル一覧を返す
                // __mockGitStatus が未設定の場合は git リポジトリ外環境を模してエラーを返す
                if (type === "git_status_request") {
                    type GitStatusWindow = { __mockGitStatus: { changes: object[]; staged: object[] } | undefined };
                    const mockStatus = (window as unknown as GitStatusWindow).__mockGitStatus;
                    if (mockStatus === undefined) {
                        dispatch({ type: "git_status_response", requestId, success: false, error: "not a git repository" });
                        return;
                    }
                    dispatch({
                        type: "git_status_response",
                        requestId,
                        success: true,
                        data: mockStatus,
                    });
                    return;
                }

                // git差分機能: HEAD時点のファイル内容を返す
                // __mockGitShowError が設定されている場合はそのエラーメッセージを返す（エラー種別テスト用）
                // __mockGitHeadFiles が未設定の場合は git リポジトリ外環境を模してエラーを返す
                if (type === "git_show_request") {
                    const path = request.path as string;
                    // テストからgit showの任意エラーを注入するためのモック変数
                    // プロパティ未設定の既存テストではスキップし、設定済みの場合のみエラーを返す
                    if ('__mockGitShowError' in window) {
                        const forcedError = (window as unknown as { __mockGitShowError: string }).__mockGitShowError;
                        dispatch({ type: "git_show_response", requestId, success: false, error: forcedError });
                        return;
                    }
                    type GitHeadFilesWindow = { __mockGitHeadFiles: Record<string, string> | undefined };
                    const headFiles = (window as unknown as GitHeadFilesWindow).__mockGitHeadFiles;
                    if (headFiles === undefined) {
                        dispatch({ type: "git_show_response", requestId, success: false, error: "not a git repository" });
                        return;
                    }
                    if (path in headFiles) {
                        dispatch({
                            type: "git_show_response",
                            requestId,
                            success: true,
                            data: headFiles[path],
                        });
                    } else {
                        dispatch({
                            type: "git_show_response",
                            requestId,
                            success: false,
                            error: "fatal: path '" + path + "' does not exist in 'HEAD'",
                        });
                    }
                    return;
                }

                // git add: changesからstagedに対象エントリを移動する
                if (type === "git_add_request") {
                    const path = request.path as string;
                    type GitStatusWindow = { __mockGitStatus: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] } | undefined };
                    const mockStatus = (window as unknown as GitStatusWindow).__mockGitStatus;
                    if (mockStatus === undefined) {
                        dispatch({ type: "git_add_response", requestId, success: false, error: "not a git repository" });
                        return;
                    }
                    const idx = mockStatus.changes.findIndex(e => e.path === path);
                    if (idx !== -1) {
                        const entry = mockStatus.changes.splice(idx, 1)[0];
                        mockStatus.staged.push(entry);
                    }
                    dispatch({ type: "git_add_response", requestId, success: true });
                    return;
                }

                // git reset: stagedからchangesに対象エントリを移動する
                if (type === "git_reset_request") {
                    const path = request.path as string;
                    type GitStatusWindow = { __mockGitStatus: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] } | undefined };
                    const mockStatus = (window as unknown as GitStatusWindow).__mockGitStatus;
                    if (mockStatus === undefined) {
                        dispatch({ type: "git_reset_response", requestId, success: false, error: "not a git repository" });
                        return;
                    }
                    const idx = mockStatus.staged.findIndex(e => e.path === path);
                    if (idx !== -1) {
                        const entry = mockStatus.staged.splice(idx, 1)[0];
                        mockStatus.changes.push(entry);
                    }
                    dispatch({ type: "git_reset_response", requestId, success: true });
                    return;
                }

                // git discard: changesから対象エントリを削除する（変更破棄）
                // git checkout -- はステージを解除しないためstagedは操作しない
                if (type === "git_discard_request") {
                    const path = request.path as string;
                    type GitStatusWindow = { __mockGitStatus: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] } | undefined };
                    const mockStatus = (window as unknown as GitStatusWindow).__mockGitStatus;
                    if (mockStatus === undefined) {
                        dispatch({ type: "git_discard_response", requestId, success: false, error: "not a git repository" });
                        return;
                    }
                    const changesIdx = mockStatus.changes.findIndex(e => e.path === path);
                    if (changesIdx !== -1) { mockStatus.changes.splice(changesIdx, 1); }
                    dispatch({ type: "git_discard_response", requestId, success: true });
                    return;
                }

                // git blame: __mockGitBlame[filename] のモックデータを返す
                if (type === "git_blame_request") {
                    const filename = request.filename as string;
                    type BlameWindow = { __mockGitBlame: Record<string, object[]> | undefined };
                    const mockBlame = (window as unknown as BlameWindow).__mockGitBlame;
                    if (mockBlame === undefined) {
                        dispatch({ type: "git_blame_response", requestId, success: false, error: "git blame not available" });
                        return;
                    }
                    const entries = mockBlame[filename];
                    if (entries) {
                        dispatch({ type: "git_blame_response", requestId, success: true, data: entries });
                    } else {
                        dispatch({ type: "git_blame_response", requestId, success: true, data: [] });
                    }
                    return;
                }

                // git log: __mockGitLog[filename] のモックデータを返す
                if (type === "git_log_request") {
                    const filename = request.filename as string;
                    type LogWindow = { __mockGitLog: Record<string, object[]> | undefined };
                    const mockLog = (window as unknown as LogWindow).__mockGitLog;
                    if (mockLog === undefined) {
                        dispatch({ type: "git_log_response", requestId, success: false, error: "git log not available" });
                        return;
                    }
                    const entries = mockLog[filename];
                    if (entries) {
                        dispatch({ type: "git_log_response", requestId, success: true, data: entries });
                    } else {
                        dispatch({ type: "git_log_response", requestId, success: true, data: [] });
                    }
                    return;
                }

                // git show at commit: __mockGitCommitFiles[commit][path] のモックデータを返す
                if (type === "git_show_at_commit_request") {
                    const commit = request.commit as string;
                    const path = request.path as string;
                    type CommitFilesWindow = { __mockGitCommitFiles: Record<string, Record<string, string>> | undefined };
                    const commitFiles = (window as unknown as CommitFilesWindow).__mockGitCommitFiles;
                    if (commitFiles === undefined) {
                        dispatch({ type: "git_show_at_commit_response", requestId, success: false, error: "git show at commit not available" });
                        return;
                    }
                    const filesAtCommit = commitFiles[commit];
                    if (filesAtCommit && path in filesAtCommit) {
                        dispatch({ type: "git_show_at_commit_response", requestId, success: true, data: filesAtCommit[path] });
                    } else {
                        dispatch({ type: "git_show_at_commit_response", requestId, success: false, error: "fatal: path '" + path + "' does not exist in '" + commit + "'" });
                    }
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
        { fs: fileSystem, instanceId: mockFsInstanceId },
    );
}

/**
 * モックファイルシステムからファイル内容を取得する
 * テストで保存結果を検証するために使用する
 */
export async function readMockFileAsync(page: Page, path: string): Promise<string> {
    return page.evaluate(
        (p) => (window as unknown as { __mockFs: { [key: string]: string } }).__mockFs[p], path
    );
}
