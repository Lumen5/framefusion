import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config/
export default defineConfig({
    test: {
        setupFiles: 'vitest.global.ts',
        globals: true,
        threads: false,
    },
});
