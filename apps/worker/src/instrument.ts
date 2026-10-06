import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTelemetry } from '@olly/telemetry';

// Primeiro import do `main.ts`: carrega o .env e inicia a telemetria (spec 012). Sem coletor
// configurado, nada é iniciado.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const telemetry = startTelemetry({ serviceName: 'olly-worker' });
