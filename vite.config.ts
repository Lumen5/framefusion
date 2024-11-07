import path from 'path';
import { defineConfig } from 'vite';
import eslint from 'vite-plugin-eslint';
import autoExternal from 'rollup-plugin-auto-external';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'framefusion.ts'),
            name: 'framefusion.ts',
            fileName: (format) => {
                if (format === 'es') {
                    return 'framefusion.es.js';
                }
                if (format === 'cjs') {
                    return 'framefusion.cjs';
                }
                if (format === 'iife') {
                    return 'framefusion.iife.js'; // file for browser global
                }

                throw new Error(`Please provide a fileName for ${format}`);
            },
            formats: ['es', 'cjs', 'iife'],
        },
        rollupOptions: {
            external: ['node:https'],
        },
        sourcemap: true,
    },
    define: {
        global: {},
    },
    optimizeDeps: {
        disabled: true,
    },
    plugins: [autoExternal(), eslint()],
});
