import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'framefusion.ts'),
            name: 'framefusion.ts',
            fileName: (format) => `framefusion.${format}.js`,
            formats: ['es']
        },
        rollupOptions: {
            // Some libraries do not work well with Rollup and should be listed here.
            // Examples are 'gl' and 'fs'.
            external: ['beamcoder', 'http', 'https'],
        },
        sourcemap: true,
    },
    define: {
        global: {},
    },
    optimizeDeps: {
        disabled: true,
    },
    plugins: [],
});
