# Governança

Cofre de segredos, login institucional com papéis por grupo, histórico de versões, aprovação de publicação e auditoria. Introduzidos na [spec 009](../specs/009-governanca-lgpd-sso/spec.md). A proteção de dados pessoais (mascaramento, política de dados e retenção) está em [lgpd.md](lgpd.md).

> **Decisões institucionais pendentes.** A [ADR-0005](adr/0005-autenticacao-oidc.md) (IdP) e a [ADR-0007](adr/0007-gestao-de-segredos.md) (cofre) ainda estão em `Proposta`. A plataforma fala só OIDC e a API HTTP do Vault; o ambiente local usa Keycloak e Vault de desenvolvimento.

## Cofre da chave mestra (FR-001 a FR-003)

As credenciais usam *envelope encryption* ([credenciais.md](credenciais.md)): cada uma tem uma chave de dados (DEK), cifrada pela chave mestra (KEK). A KEK vem de um provedor escolhido por `OLLY_KEY_PROVIDER`:

| Provedor | KEK | Autenticação | Uso |
|---|---|---|---|
| `env` | `OLLY_MASTER_KEY` (base64, 32 bytes) | — | Desenvolvimento |
| `vault` | Chave do **Vault Transit** (`OLLY_VAULT_TRANSIT_KEY`); nunca sai do Vault | AppRole (`OLLY_VAULT_ROLE_ID`/`OLLY_VAULT_SECRET_ID`) ou conta de serviço do Kubernetes (`OLLY_VAULT_AUTH=kubernetes`, `OLLY_VAULT_K8S_ROLE`) | Homologação e produção |

Nenhum token do Vault fica em código ou configuração. A API faz login no Vault, renova o token antes de expirar e repete o login se o Vault o revogar. O provedor KMS de nuvem não foi implementado e depende da ADR-0007.

Cada credencial guarda em `key_provider` + `key_version` qual chave cifrou sua DEK. A API decifra com qualquer provedor configurado e cifra as novas credenciais sempre com o atual. Por isso a troca de chave não exige parar o serviço (NFR-001).

### Rotação (FR-002)

```bash
# Vault: cria uma nova versão da chave no Transit e recifra as DEKs.
pnpm credentials:rotate --rotate-vault-key

# Provedor env: configure a chave nova e mantenha a anterior até o fim do comando.
#   OLLY_MASTER_KEY=<nova>  OLLY_MASTER_KEY_VERSION=2  OLLY_MASTER_KEYS_PREVIOUS=1:<antiga>
pnpm credentials:rotate
```

- Processa em lotes de 100 e recifra **só a DEK**: os dados cifrados não são decifrados nem alterados.
- O checkpoint é a própria credencial. Se o comando for interrompido, a execução seguinte continua de onde parou; repetido, não faz nada.
- Cada lote vai para a auditoria (`credential.key.rotate.start`, `.progress` e `.finish`), sem valores.
- Se uma credencial for editada no meio da rotação, ela já é gravada com a chave nova e o comando a ignora.

Depois da rotação de um provedor `env`, a chave anterior pode sair de `OLLY_MASTER_KEYS_PREVIOUS`.

### Migração do provedor local para o Vault (FR-003)

1. Configure `OLLY_KEY_PROVIDER=vault` e as variáveis `OLLY_VAULT_*`, **mantendo** `OLLY_MASTER_KEY`, e reinicie a API e os workers. As credenciais novas já vão para o Vault, e as antigas continuam legíveis.
2. Rode `pnpm credentials:migrate --from env --to vault`. O comando é retomável e fica auditado como `credential.key.migrate.*`.
3. Remova `OLLY_MASTER_KEY` quando o relatório indicar zero pendências.

### Vault de desenvolvimento

O serviço `vault` do `docker-compose.yml`:
- usa a imagem `hashicorp/vault`, sob a licença BUSL-1.1, que permite uso interno e de desenvolvimento;
- guarda os dados no volume `vault-data`;
- é inicializado e destravado sozinho, com a chave de unseal no próprio volume, o que só serve para desenvolvimento;
- roda [`infra/vault/init.sh`](../infra/vault/init.sh), que cria:
  - o Transit com a chave `olly-credentials`;
  - o AppRole `olly-api`, com as credenciais definidas em `OLLY_VAULT_ROLE_ID`/`OLLY_VAULT_SECRET_ID`;
  - as políticas: `olly-api` (cifrar, decifrar e ler a versão) e `olly-key-admin` (rotacionar).

Os testes de integração usam o mesmo script.

Em produção, o comando de rotação deve rodar com uma identidade que tenha a política `olly-key-admin`. A API precisa só da `olly-api`.

## Login institucional e papéis por grupo (FR-004 a FR-007)

- **OIDC genérico:**
  - a API valida o access token de qualquer IdP OIDC (descoberta + JWKS);
  - os grupos vêm da claim `OIDC_GROUPS_CLAIM` (padrão `groups`);
  - no Entra ID, acima de cerca de 200 grupos o token traz uma referência ao Microsoft Graph (*overage*). Esse caso é registrado em log e não aplica papéis; o resolvedor via Graph depende da ADR-0005.
- **Mapeamentos (Administração → SSO e usuários):** grupo do IdP → papel, em um projeto ou em todos (global). Exigem `user:manage` na administração da plataforma.
- **Sincronização no login:**
  - o frontend registra o login (`POST /api/v1/auth/login`) logo após voltar do IdP;
  - a API calcula os vínculos esperados pelos grupos do token, cria os que faltam, ajusta o papel e remove os vínculos de origem `idp` que não se aplicam mais;
  - um token novo com outros grupos também sincroniza em qualquer chamada;
  - vínculos `manual` (feitos na tela de projetos) nunca são alterados. Ajustar à mão um vínculo herdado o torna manual;
  - com vários grupos para o mesmo projeto, vale o papel com mais permissões;
  - mudanças são auditadas (`user.idp_sync`).
- **Papel global:** vale em todos os projetos enquanto o token trouxer o grupo; não cria vínculos. O grupo `OIDC_ADMIN_GROUP` continua dando todas as permissões.
- **Inativação (FR-006):**
  - quem foi desativado no IdP não consegue token novo. O token já emitido expira em minutos (o access token do Keycloak dura 5 min);
  - o job diário marca como inativos os usuários sem login há `OLLY_USER_INACTIVE_DAYS` (90), auditado como `user.inactivate`;
  - usuário inativo recebe 403 em toda rota e no login;
  - a reativação é feita em **Administração → SSO e usuários** (`PUT /admin/users/:id/active`), e a desativação manual corta o acesso na hora na instância que a recebeu;
  - nas demais instâncias, o cache de usuários leva até 30 s para refletir a mudança.
- **Auditoria de login (FR-007):**
  - `auth.login` registra usuário, IP e grupos;
  - `auth.login_failed` registra token inválido ou usuário inativo, com o motivo e o `sub` não verificado, nunca o token;
  - as falhas de login são limitadas a 30 por minuto por IP;
  - senha errada acontece no IdP e não chega à plataforma: fica nos eventos do próprio IdP.

## Histórico e comparação de versões (FR-008 a FR-010)

- Cada salvamento cria uma versão. A **mensagem** é opcional ao salvar (painel Histórico → "Salvar versão") e obrigatória ao publicar.
- Na publicação, a mensagem vira a mensagem da versão quando ela não tem uma, e sempre fica na auditoria.
- **Painel Histórico (editor):**
  - lista as versões com autor, data, mensagem e qual está publicada;
  - **Comparar com a atual** mostra o diff no canvas: adicionados em verde, alterados em amarelo, removidos em vermelho tracejado (fantasmas na posição antiga), conexões novas e removidas;
  - o painel lista o patch de cada nó (`campo: antes → depois`);
  - durante a comparação o canvas fica somente leitura.
- **Restaurar** cria uma **nova** versão com a definição antiga ("Restaurada da versão N"), com as mesmas validações de um salvamento. O histórico nunca é reescrito.
- **API:**
  - `GET /workflows/:id/versions`, `GET /workflows/:id/versions/:v` (`workflow:read`);
  - `GET /workflows/:id/diff?from=&to=` (`workflow:read`): JSON Patch RFC 6902 por nó, calculado com `fast-json-patch`;
  - `POST /workflows/:id/versions/:v/restore` (`workflow:update`).

## Aprovação de publicação (FR-011)

- Ativada por projeto (**Administração → projeto → Governança**, `project:manage`).
- Com a aprovação ativa:
  - "Publicar" vira "Pedir publicação" e cria um pedido pendente, com versão e mensagem. Só um pedido pendente por workflow;
  - quem tem `workflow:publish` no projeto e **não é o autor** aprova (o que publica de fato, em nome de quem aprovou) ou rejeita, com comentário;
  - o autor não aprova nem rejeita o próprio pedido; ele pode cancelá-lo. A regra também está no banco, por um `CHECK`.
- Se a publicação falhar na aprovação (por exemplo, caminho de webhook ocupado), o pedido volta a ficar pendente.
- **Notificação na aplicação:** o menu **Aprovações** mostra quantos pedidos aguardam a decisão do usuário. O editor mostra o pedido pendente do workflow.
- Tudo é auditado: `workflow.publish_request`, `.approve`, `.reject`, `.cancel` e `workflow.publish`.

## Auditoria (FR-018)

- **Administração → Auditoria**, com `audit:read` no escopo da plataforma. O papel admin de um projeto não tem acesso.
- Filtros por ação (exata ou prefixo com `*`, como `workflow.*`), entidade, id da entidade, usuário e período. Paginação por cursor, com os mais recentes primeiro.
- **Exportar CSV** (`GET /audit/export.csv`):
  - streaming em lotes de 1.000, com paginação por chave e respeitando a contrapressão da conexão; 100 mil registros (77 MB) crescem cerca de 1,4 MB de memória viva;
  - CSV em UTF-8 com BOM, para o Excel;
  - toda célula vai entre aspas, e as que começam com `=`, `+`, `-` ou `@` ganham `'`, contra injeção de fórmulas.
- A tabela `audit_log` é *append-only*: um trigger impede `UPDATE`, `DELETE` e `TRUNCATE`.

## Permissões

Ver a [matriz RBAC](rbac-matriz.md). Resumo do que esta spec acrescenta:

| Ação | Permissão | Escopo |
|---|---|---|
| Histórico, versões e diff | `workflow:read` | Projeto |
| Restaurar versão | `workflow:update` | Projeto |
| Aprovar ou rejeitar pedido de publicação | `workflow:publish` | Projeto (nunca o autor) |
| Governança do projeto e regras de mascaramento do projeto | `project:manage` | Projeto |
| Grupos do IdP, usuários (reativar/desativar) | `user:manage` | Plataforma |
| Regras globais de mascaramento | `project:manage` | Plataforma |
| Consultar e exportar a auditoria | `audit:read` | Plataforma |
| Executor vê os dados das execuções | `execution:readData` | Projeto, quando "Executor vê os dados" está ativo (FR-019) |
