import type {BackgroundTaskTracker} from "./background-task-tracker";

/** postMessageAsync に統合されるバックグラウンドタスクトラッカー（main.ts で設定される） */
let tracker: BackgroundTaskTracker | false = false;

/**
 * バックグラウンドタスクトラッカーを設定する。
 * main.ts で StatusBar 生成後に呼び出し、C# との全通信を追跡対象にする。
 */
export function configureBackgroundTracker(t: BackgroundTaskTracker): void {
    tracker = t;
}

// =========================================================================
// ファイルキャッシュ
// 起動時に全ファイルを一括読み込みし、以降はキャッシュから同期的に返す。
// writeFileAsync / deleteFileAsync でキャッシュも同期的に更新する。
// =========================================================================
const fileCache = new Map<string, string>();
const dirCache = new Map<string, File[]>();

/**
 * 起動時に schema/ と data/ 以下の全ファイルを一括読み込みしてキャッシュに格納する。
 * main.ts の初期化冒頭で呼び出すこと。
 * ディレクトリ列挙・ファイル読み込みを並列で実行し、起動時間を短縮する。
 */
export async function preloadAllFilesAsync(): Promise<void> {
    // schema/, data/, plugins/ のディレクトリ列挙を並列実行する
    const [schemaFiles, dataFiles, pluginFilesResult] = await Promise.all([
        postMessageAsync<File[]>('find_files', { directory: 'schema' }),
        postMessageAsync<File[]>('find_files', { directory: 'data' }),
        postMessageAsync<File[]>('find_files', { directory: 'plugins' }).then(
            (files) => ({ files, found: true as const }),
            () => ({ files: [] as File[], found: false as const }),
        ),
    ]);
    dirCache.set('schema', schemaFiles);
    dirCache.set('data', dataFiles);
    if (pluginFilesResult.found) dirCache.set('plugins', pluginFilesResult.files);

    // 全ディレクトリのファイル読み込みを並列実行する（C#側がバックグラウンドスレッドで処理する）
    const readTasks: Promise<void>[] = [];
    for (const file of schemaFiles) {
        if (file.type !== 'file') continue;
        const path = `schema/${file.name}`;
        readTasks.push(postMessageAsync<string>('read_file', { filename: path }).then((content) => { fileCache.set(path, content); }));
    }
    for (const file of dataFiles) {
        if (file.type !== 'file') continue;
        const path = `data/${file.name}`;
        readTasks.push(postMessageAsync<string>('read_file', { filename: path }).then((content) => { fileCache.set(path, content); }));
    }
    for (const file of pluginFilesResult.files) {
        if (file.type !== 'file') continue;
        const path = `plugins/${file.name}`;
        readTasks.push(postMessageAsync<string>('read_file', { filename: path }).then((content) => { fileCache.set(path, content); }));
    }
    await Promise.all(readTasks);
}

/**
 * ファイルに文字列データを書き込む（汎用API）
 * 書き込み後にキャッシュも更新する。
 */
export async function writeFileAsync(filename: string, data: string): Promise<void> {
    await postMessageAsync('write_file', { filename, data });
    fileCache.set(filename, data);
    invalidateGitStatusCache();
}

/** ファイルキャッシュの特定エントリを無効化する。テストやファイルウォッチャーで外部変更された場合に呼ぶ。 */
export function invalidateFileCacheEntry(filename: string): void {
    fileCache.delete(filename);
}

/**
 * ファイルから文字列データを読み込む（汎用API）
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function readFileAsync(filename: string): Promise<string> {
    const startTime = performance.now();
    const cached = fileCache.get(filename);
    if (cached !== undefined) {
        if (tracker !== false) tracker.recordCacheHit('read_file', startTime);
        return cached;
    }
    const result = await postMessageAsync<string>('read_file', { filename });
    fileCache.set(filename, result);
    return result;
}

interface File {
    name: string;
    type: 'file' | 'directory';
}

/**
 * ファイルを削除する（汎用API）
 * 削除後にキャッシュからも除去する。
 */
export async function deleteFileAsync(filename: string): Promise<void> {
    await postMessageAsync('delete_file', { filename });
    fileCache.delete(filename);
    invalidateGitStatusCache();
}

/**
 * 指定したディレクトリ以下のファイル一覧を列挙する
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function findFilesAsync(directory: string): Promise<File[]> {
    const startTime = performance.now();
    const cached = dirCache.get(directory);
    if (cached !== undefined) {
        if (tracker !== false) tracker.recordCacheHit('find_files', startTime);
        return cached;
    }
    const result = await postMessageAsync<File[]>('find_files', { directory });
    dirCache.set(directory, result);
    return result;
}

/**
 * git status で変更されたCSVファイルの一覧
 * isNew: true のとき新規ファイル（??ステータス）。HEAD版CSVが存在しないため git show を呼ばない
 */
export interface GitStatusEntry {
    path: string;
    tableName: string;
    isNew: boolean;
}

/**
 * git status レスポンス
 */
export interface GitStatusResult {
    changes: GitStatusEntry[];
    staged: GitStatusEntry[];
}

// =========================================================================
// git status キャッシュ
// ファイル書き込み・git操作で無効化し、それ以外はキャッシュを返す。
// =========================================================================
let gitStatusCache: GitStatusResult | false = false;

/** git status キャッシュを無効化する。writeFileAsync / git操作 / ファイルウォッチャー / gitアイコンクリック後に呼ばれる。 */
export function invalidateGitStatusCache(): void {
    gitStatusCache = false;
}

/**
 * git status を実行し、変更ファイル・ステージ済みファイルの一覧を返す。
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function gitStatusAsync(): Promise<GitStatusResult> {
    const startTime = performance.now();
    if (gitStatusCache !== false) {
        if (tracker !== false) tracker.recordCacheHit('git_status', startTime);
        return gitStatusCache;
    }
    const result = await postMessageAsync<GitStatusResult>('git_status', {});
    gitStatusCache = result;
    return result;
}

// =========================================================================
// git show キャッシュ
// パスごとにHEAD版の内容をキャッシュする。
// ファイルウォッチャー・git操作で全無効化し、差分ビュー表示時はキャッシュをバイパスする。
// =========================================================================
const gitShowCache = new Map<string, string>();

/** git show キャッシュを全無効化する。ファイルウォッチャー / git操作後に呼ばれる。 */
export function invalidateGitShowCache(): void {
    gitShowCache.clear();
}

/**
 * git show HEAD:path でHEAD時点のファイル内容を返す。
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function gitShowAsync(path: string): Promise<string> {
    const startTime = performance.now();
    const cached = gitShowCache.get(path);
    if (cached !== undefined) {
        if (tracker !== false) tracker.recordCacheHit('git_show', startTime);
        return cached;
    }
    const result = await postMessageAsync<string>('git_show', { path });
    gitShowCache.set(path, result);
    return result;
}

/**
 * git show HEAD:path でHEAD時点のファイル内容を返す。キャッシュをバイパスして常にC#へ問い合わせる。
 * 差分ビュー表示時に使用する。取得結果でキャッシュを更新する。
 */
export async function gitShowFreshAsync(path: string): Promise<string> {
    const result = await postMessageAsync<string>('git_show', { path });
    gitShowCache.set(path, result);
    return result;
}

/**
 * git add でファイルをステージする
 */
export async function gitAddAsync(path: string): Promise<void> {
    await postMessageAsync('git_add', { path });
    invalidateGitStatusCache();
    invalidateGitShowCache();
}

/**
 * git reset でファイルをアンステージする
 */
export async function gitResetAsync(path: string): Promise<void> {
    await postMessageAsync('git_reset', { path });
    invalidateGitStatusCache();
    invalidateGitShowCache();
}

/**
 * git checkout -- でファイルの変更を破棄する
 */
export async function gitDiscardAsync(path: string): Promise<void> {
    await postMessageAsync('git_discard', { path });
    invalidateGitStatusCache();
    invalidateGitShowCache();
}

// =========================================================================
// git blame / git log
// 変更履歴・監査ログ機能で使用する。キャッシュは持たない（都度取得）。
// =========================================================================

/** git blame の1行分のエントリ */
export interface BlameEntry {
    lineNumber: number;
    author: string;
    date: string;
    commitHash: string;
    commitMessage: string;
}

/** git log の1コミット分のエントリ */
export interface LogEntry {
    commitHash: string;
    author: string;
    date: string;
    message: string;
}

/**
 * git blame でファイルの各行の著者・日付・コミット情報を取得する
 */
export async function gitBlameAsync(filename: string): Promise<BlameEntry[]> {
    return postMessageAsync<BlameEntry[]>('git_blame', { filename });
}

/**
 * git log でファイルのコミット履歴を取得する
 * @param filename 対象ファイルパス
 * @param limit 取得するコミット数の上限
 */
export async function gitLogAsync(filename: string, limit: number): Promise<LogEntry[]> {
    return postMessageAsync<LogEntry[]>('git_log', { filename, limit });
}

/**
 * git show commit:path で任意コミット時点のファイル内容を返す。
 * バージョン比較機能で使用する。キャッシュは持たない（都度取得）。
 * @param commit コミットハッシュ
 * @param path ファイルパス
 */
export async function gitShowAtCommitAsync(commit: string, path: string): Promise<string> {
    return postMessageAsync<string>('git_show_at_commit', { commit, path });
}

/**
 * リクエストIDカウンター
 * 各リクエストにユニークIDを付与し、レスポンスをIDで照合する。
 * これにより同じ種類のリクエストを並列に送信しても取り違えが起きない。
 */
let nextRequestId = 1;

function postMessageAsync<T>(
    apiName: string,
    requestData: Record<string, unknown>
): Promise<T> {
    const promise = sendRequest<T>(apiName, requestData);
    // トラッカーが設定されている場合はバックグラウンドタスクとして追跡する
    if (tracker !== false) {
        return tracker.trackAsync(apiName, promise);
    }
    return promise;
}

function sendRequest<T>(
    apiName: string,
    requestData: Record<string, unknown>
): Promise<T> {
    const requestId = String(nextRequestId++);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.chrome.webview.removeEventListener('message', responseHandler);
            reject(new Error(`${apiName} timeout (requestId=${requestId})`));
        }, 10000);

        const responseHandler = (event: MessageEvent) => {
            try {
                const responseData = JSON.parse(event.data);
                // リクエストIDで照合する。IDが一致しないメッセージは無視して待ち続ける。
                if (!responseData || responseData.type !== `${apiName}_response` || responseData.requestId !== requestId) {
                    return;
                }

                clearTimeout(timeout);
                window.chrome.webview.removeEventListener('message', responseHandler);

                if (responseData.success) {
                    resolve(responseData.data as T);
                } else {
                    reject(new Error((responseData.error as string) || `${apiName} failed`));
                }

            } catch (error) {
                clearTimeout(timeout);
                window.chrome.webview.removeEventListener('message', responseHandler);
                reject(error);
            }
        };

        try {
            window.chrome.webview.addEventListener('message', responseHandler);
            window.chrome.webview.postMessage(JSON.stringify({
                type: `${apiName}_request`,
                requestId,
                ...requestData
            }));
        } catch (error) {
            clearTimeout(timeout);
            reject(error);
        }
    });
}
