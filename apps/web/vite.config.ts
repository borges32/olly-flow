import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // O .env único fica na raiz do monorepo. Só variáveis VITE_* chegam ao navegador.
  const env = loadEnv(mode, repoRoot, '');
  const apiTarget = env.API_URL ?? 'http://localhost:3000';
  // Mesma origem para a SPA e a API: sem CORS em desenvolvimento.
  const proxy = {
    '/api': apiTarget,
    '/health': apiTarget,
    // Eventos de execução em tempo real (socket.io).
    '/socket.io': { target: apiTarget, ws: true },
  };

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // A porta é fixa: é o redirect URI registrado no IdP.
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 5173, strictPort: true, proxy },
  };
});
