import {defineConfig, Plugin, UserConfig} from 'vite'


function removeModuleType(): Plugin {
    return {
        name: 'remove-module-type',
        transformIndexHtml(html) {
            return html.replace(/\s*crossorigin/g, '').replace(/\s*type="module"/g, '')
        }
    }
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
    config = {
        base: './',
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
