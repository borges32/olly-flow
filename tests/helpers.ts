import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));

export function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

export function readJson(path: string): unknown {
  return JSON.parse(read(path));
}

export function listFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .map((p) => join(dir, p))
    .filter((p) => statSync(join(root, p)).isFile());
}
