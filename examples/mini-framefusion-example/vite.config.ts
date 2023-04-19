import path from 'path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        lib: {
            formats: ['es'],
            entry: path.resolve(__dirname, 'main.ts'),
            name: 'main.ts',
            fileName: (format) => `main.${format}.js`,
        },
        rollupOptions: {
            input: 'main.ts',
            external: [
                '@pixi/mixin-get-{}-position',
                'gl',
                'path',
                'fs',
                '@pixi/node',
                'canvas',
                'framefusion',
                'child_process',
                'rimraf',
                'perf_hooks',
            ],
        },
        sourcemap: true,
    },
    plugins: [],
});
