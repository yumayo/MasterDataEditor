import {defineConfig, loadEnv, Plugin, UserConfig} from 'vite'
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

function getRequiredDevPort(): number {
    const rawPort = env.MASTER_DATA_EDITOR_DEV_PORT
    const devPort = Number.parseInt(rawPort, 10)
    if (!Number.isFinite(devPort)) {
        throw new Error('Environment variable "MASTER_DATA_EDITOR_DEV_PORT" is required and must be a valid integer.')
    }

    return devPort
}

let config: UserConfig;

if (process.env.NODE_ENV === 'production') {
    config = {
        base: './',
        plugins: [removeModuleType()],
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    main: './index.html'
                },
                output: {
                    format: 'iife',
                    entryFileNames: 'assets/[name]-[hash].js',
                    chunkFileNames: 'assets/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash].[ext]'
                }
            }
        }
    }
} else {
    const devPort = getRequiredDevPort()
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
