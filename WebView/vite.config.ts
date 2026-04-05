import {defineConfig, loadEnv, Plugin, UserConfig} from 'vite'
import path from 'path'

// 親ディレクトリの .env を読み込む
const env = loadEnv('development', path.resolve(__dirname, '..'), '')

function removeModuleType(): Plugin {
    return {
        name: 'remove-module-type',
        transformIndexHtml(html) {
            return html.replace(/\s*crossorigin/g, '').replace(/type="module"/g, 'defer')
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
        plugins: [removeModuleType()],
        esbuild: {
            // リリースビルドでは console.log / console.debug を除去する。
            // console.warn / console.error は残す（運用時のエラー検知に必要）。
            // テスト時（PLAYWRIGHT=1）はAI開発のデバッグログを残すため除去しない。
            ...(env.PLAYWRIGHT !== '1' ? { pure: ['console.log', 'console.debug'] } : {}),
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    main: './index.html'
                },
                output: {
                    format: 'iife',
                    entryFileNames: 'assets/[name].js',
                    chunkFileNames: 'assets/[name].js',
                    assetFileNames: 'assets/[name].[ext]'
                }
            }
        }
    }
} else {
    const devPort = getDevPort()
    config = {
        base: './',
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
