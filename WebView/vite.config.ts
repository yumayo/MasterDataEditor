import {defineConfig, loadEnv, Plugin, UserConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Load .env from parent directory
const env = loadEnv('development', path.resolve(__dirname, '..'), '')

function removeModuleType(): Plugin {
    return {
        name: 'remove-module-type',
        transformIndexHtml(html) {
            return html.replace(/\s*crossorigin/g, '').replace(/\s*type="module"/g, '')
        }
    }
}

function getDevPort(): number {
    const rawPort = env.MASTER_DATA_EDITOR_DEV_PORT
    // NOTE: ガイドラインよりも実行のしやすさを優先するため特別にフォールバックを許可
    if (!rawPort) return 5173
    const devPort = Number.parseInt(rawPort, 10)
    if (!Number.isFinite(devPort)) {
        throw new Error('Environment variable "MASTER_DATA_EDITOR_DEV_PORT" must be a valid integer.')
    }

    return devPort
}

let config: UserConfig;

if (process.env.NODE_ENV === 'production') {
    config = {
        base: './',
        plugins: [react(), removeModuleType()],
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    main: './index.html'
                },
                output: {
                    // WebView2はChromiumベースだがネイティブアプリ埋め込みのためiifeフォーマットを使用。
                    // iife はコード分割（React.lazy() / dynamic import）をサポートしないため、
                    // 全コンポーネントを同期的にインポートすること。
                    format: 'iife',
                    entryFileNames: 'assets/[name]-[hash].js',
                    chunkFileNames: 'assets/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash].[ext]'
                }
            }
        }
    }
} else {
    const devPort = getDevPort()
    config = {
        base: './',
        plugins: [react()],
        server: {
            port: devPort,
            strictPort: true
        },
        build: {
            outDir: '../dist',
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    main: './index.html'
                }
            }
        }
    }
}

export default defineConfig(config)
