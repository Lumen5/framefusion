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
            fileName: (format) => `framefusion.${format}.js`,
            formats: ['es'],
        },
        rollupOptions: {
            external: [],
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
