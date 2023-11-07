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

                throw new Error(`Please provide a fileName for ${format}`);
            },
            formats: ['es', 'cjs'],
        },
        rollupOptions: {
            external: [
                'node:https',
                '@napi-rs/canvas',
                /@napi-rs\/canvas.*/,
            ],
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
