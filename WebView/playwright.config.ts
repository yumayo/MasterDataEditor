import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    outputDir: './test-results',
    fullyParallel: true,
    forbidOnly: false,
    retries: 0,
    workers: 16,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome']},
        },
    ],
    webServer: {
        command: 'npx vite build && npx vite preview --host',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
    },
});
