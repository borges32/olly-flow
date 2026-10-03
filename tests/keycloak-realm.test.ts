import { describe, expect, it } from 'vitest';
import { read, readJson } from './helpers.js';

interface Realm {
  realm: string;
  groups: { name: string }[];
  users: {
    username: string;
    email: string;
    enabled: boolean;
    groups: string[];
    credentials: { temporary: boolean }[];
  }[];
  clients: {
    clientId: string;
    publicClient?: boolean;
    directAccessGrantsEnabled?: boolean;
    redirectUris?: string[];
    attributes?: Record<string, string>;
    protocolMappers?: { protocolMapper: string; config: Record<string, string> }[];
  }[];
}

const realm = readJson('infra/keycloak/olly-realm.json') as Realm;
const web = realm.clients.find((c) => c.clientId === 'olly-web');

describe('FR-003: usuários de teste do IdP de desenvolvimento', () => {
  it.each(['admin', 'editor', 'executor', 'viewer'])(
    'FR-003: %s@olly.local no grupo %s',
    (role) => {
      expect(realm.groups.map((g) => g.name)).toContain(role);
      const user = realm.users.find((u) => u.username === `${role}@olly.local`);
      expect(user).toMatchObject({
        email: `${role}@olly.local`,
        enabled: true,
        groups: [`/${role}`],
      });
      expect(user?.credentials.every((c) => !c.temporary)).toBe(true);
    },
  );

  it('FR-003: o claim groups traz o nome simples do grupo', () => {
    const mapper = web?.protocolMappers?.find(
      (m) => m.protocolMapper === 'oidc-group-membership-mapper',
    );
    expect(mapper?.config).toMatchObject({
      'claim.name': 'groups',
      'full.path': 'false',
      'access.token.claim': 'true',
    });
  });

  it('FR-007: client olly-web é público, usa PKCE S256 e redireciona para o frontend', () => {
    expect(web).toMatchObject({ publicClient: true, redirectUris: ['http://localhost:5173/*'] });
    expect(web?.attributes?.['pkce.code.challenge.method']).toBe('S256');
  });

  it('FR-004: tokens do olly-web têm audience olly-api', () => {
    const mapper = web?.protocolMappers?.find((m) => m.protocolMapper === 'oidc-audience-mapper');
    expect(mapper?.config['included.client.audience']).toBe('olly-api');
  });
});

describe('NFR-003: password grant somente no realm de desenvolvimento', () => {
  it('NFR-003: apenas o client olly-web do realm de dev habilita o password grant', () => {
    const enabled = realm.clients.filter((c) => c.directAccessGrantsEnabled).map((c) => c.clientId);
    expect(enabled).toEqual(['olly-web']);
  });

  it('NFR-003: o realm só é carregado pelo ambiente local e está documentado como dev', () => {
    expect(read('docker-compose.yml')).toContain('./infra/keycloak/olly-realm.json');
    expect(read('infra/keycloak/README.md')).toMatch(/Somente desenvolvimento/);
  });
});
