/**
 * ファイルに文字列データを書き込む（汎用API）
 */
export async function writeFileAsync(filename: string, data: string): Promise<void> {
    return postMessageAsync('write_file', { filename, data });
}

/**
 * ファイルから文字列データを読み込む（汎用API）
 */
export async function readFileAsync(filename: string): Promise<string> {
    return postMessageAsync<string>('read_file', { filename });
}

interface File {
    name: string;
    type: 'file' | 'directory';
}

/**
 * 指定したディレクトリ以下のファイル一覧を列挙する
 */
export async function findFilesAsync(directory: string): Promise<File[]> {
    return postMessageAsync<File[]>('find_files', { directory });
}

async function postMessageAsync<T>(
    apiName: string,
    requestData: Record<string, unknown>
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.chrome.webview.removeEventListener('message', responseHandler);
            reject(new Error(`${apiName} timeout`));
        }, 10000);

        const responseHandler = (event: MessageEvent) => {
            try {
                const responseData = JSON.parse(event.data);
                console.log(`[DEBUG] ${apiName} received:`, responseData);
                // 関係のないメッセージは無視して待ち続ける
                if (!responseData || responseData.type !== `${apiName}_response`) {
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
                ...requestData
            }));
        } catch (error) {
            clearTimeout(timeout);
            reject(error);
        }
    });
}
