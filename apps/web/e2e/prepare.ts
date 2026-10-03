import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Sobe o ambiente local e prepara o banco antes do Playwright iniciar a API e o frontend.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const run = (command: string) => execSync(command, { cwd: root, stdio: 'inherit' });

run('docker compose up -d --wait');
run('pnpm db:migrate');
run('pnpm db:seed');
