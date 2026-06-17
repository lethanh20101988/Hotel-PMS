import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        // Bind to IPv6 so `localhost` (often resolves to ::1 on macOS) works in browsers.
        // On most systems this also accepts IPv4 via dual-stack.
        host: '::',
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:4000',
            changeOrigin: true,
          }
        }
      },
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          /** Import ổn định, không phụ thuộc độ sâu thư mục (refactor an toàn). */
          '@shared': path.resolve(__dirname, 'shared'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/xlsx')) return 'xlsx';
              if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'recharts';
              if (id.includes('node_modules/html2pdf')) return 'html2pdf';
            },
          },
        },
      },
    };
});
