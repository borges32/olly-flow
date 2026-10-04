# Spec 001 — Fundação

| Campo | Valor |
|---|---|
| **Status** | Verificada |
| **Fase** | 0 — Fundação |
| **Depende de** | — |
| **Requisitos de produto** | PR-08 (parcial), PR-15 (parcial), PR-19 (parcial), PR-20 (parcial) |
| **ADRs relacionadas** | 0002, 0003, 0004, 0005 |

## Contexto e problema

O repositório contém apenas documentação. Antes de entregar funcionalidades, a equipe e o agente precisam de:
- uma base técnica padronizada;
- autenticação institucional desde o primeiro dia;
- banco versionado;
- contratos centrais;
- verificação automática.

Sem essa base, cada spec seguinte refaria a infraestrutura.

## Histórias de usuário

### HU-1 — Ambiente local com um comando (P1)

Como **desenvolvedor (humano ou agente)**, quero subir todo o ambiente com um comando para começar a trabalhar sem configuração manual.

**Teste independente:** em uma máquina limpa, seguir o README e obter todos os serviços saudáveis.

**Cenários de aceite:**
1. **Dado** uma máquina com Docker e Node 22, **quando** executo os passos do README, **então** todos os serviços ficam saudáveis e o smoke test passa.

### HU-2 — Login institucional (P1)

Como **usuário**, quero entrar com minha conta institucional para acessar a plataforma sem criar uma senha nova.

**Teste independente:** login com um usuário de teste do IdP de desenvolvimento.

**Cenários de aceite:**
1. **Dado** um usuário existente no IdP, **quando** faço login, **então** vejo a tela inicial com meu nome.
2. **Dado** um acesso sem autenticação, **quando** chamo a API, **então** recebo 401.
3. **Dado** um primeiro login, **quando** autentico, **então** meu usuário é criado na plataforma com os dados do IdP.

### HU-3 — Qualidade verificada automaticamente (P1)

Como **tech lead**, quero que todo push seja verificado (lint, tipos, testes, build, dependências vulneráveis) para que nada quebrado seja integrado.

**Cenários de aceite:**
1. **Dado** um push com teste falhando, **quando** o CI executa, **então** o merge é bloqueado.

### HU-4 — Base de auditoria e papéis (P2)

Como **administrador**, quero que os papéis padrão existam e que o log de auditoria seja imutável desde o início.

**Cenários de aceite:**
1. **Dado** o banco migrado, **quando** consulto os papéis, **então** existem admin, editor, executor e viewer com as permissões da matriz.
2. **Dado** um registro de auditoria, **quando** tento alterá-lo ou apagá-lo, **então** a operação falha.

### Casos de borda

- O IdP está fora do ar: a API continua respondendo `/health` e indica a dependência degradada.
- Token expirado durante o uso: o frontend renova silenciosamente ou redireciona ao login.

## Requisitos funcionais

- **FR-001**: O repositório DEVE ser um monorepo com os workspaces definidos em `docs/arquitetura/stack.md`.
- **FR-002**: O ambiente local DEVE subir com um comando, contendo PostgreSQL, Redis, IdP de desenvolvimento e object storage, todos com healthcheck.
- **FR-003**: O IdP de desenvolvimento DEVE conter os usuários de teste `admin@olly.local`, `editor@olly.local`, `executor@olly.local` e `viewer@olly.local`, cada um em um grupo com o nome do papel.
- **FR-004**: A API DEVE rejeitar com 401 qualquer rota não pública sem token válido (assinatura, emissor, audiência e expiração).
- **FR-005**: QUANDO um usuário autentica pela primeira vez, o sistema DEVE criar o registro do usuário. Nos logins seguintes, DEVE atualizar nome e e-mail.
- **FR-006**: A API DEVE expor `GET /api/v1/me` com o usuário e suas permissões efetivas.
- **FR-007**: O frontend DEVE autenticar via OIDC (Authorization Code + PKCE), renovar o token silenciosamente e permitir logout.
- **FR-008**: A integração com o IdP NÃO DEVE conter código específico de fornecedor. Apenas a configuração OIDC.
- **FR-009**: O banco DEVE ter migrations versionadas e reversíveis para usuários, papéis, projetos, membros e auditoria.
- **FR-010**: O sistema DEVE criar (seed) os papéis admin, editor, executor e viewer com as permissões da matriz de produto.
- **FR-011**: O log de auditoria NÃO DEVE permitir alteração nem exclusão de registros.
- **FR-012**: A API DEVE expor `GET /health` com o estado do banco e do Redis.
- **FR-013**: Os contratos centrais (`docs/arquitetura/contratos.md`) DEVEM existir como tipos e schemas compartilhados.
- **FR-014**: O sistema DEVE ter um registro de nós que valida que todo nó registrado possui um schema de parâmetros válido.
- **FR-015**: O CI DEVE executar lint, typecheck, testes, build e auditoria de dependências, falhando com vulnerabilidades altas.
- **FR-016**: DEVE existir a estrutura de fixtures da POC N8N, com o formato documentado.
- **FR-017**: DEVE existir um smoke test automatizado do ambiente.

## Requisitos não funcionais

- **NFR-001**: Ambiente sobe em menos de 5 minutos em máquina com 16 GB de RAM (excluindo o download inicial de imagens).
- **NFR-002**: Nenhum segredo real versionado. Apenas `.env.example`.
- **NFR-003**: O *password grant* do IdP é habilitado somente no realm de desenvolvimento.

## Entidades-chave

- **Usuário**: identidade vinda do IdP (identificador externo, e-mail, nome, ativo).
- **Papel**: conjunto nomeado de permissões.
- **Projeto**: agrupador de workflows e credenciais.
- **Membro de projeto**: vínculo usuário–projeto–papel.
- **Registro de auditoria**: quem fez o quê, quando, de onde.

## Critérios de sucesso

- **SC-001**: `docker compose up -d` + `pnpm smoke` passam em máquina limpa seguindo o README.
- **SC-002**: Login E2E com `editor@olly.local` mostra o nome no cabeçalho.
- **SC-003**: Migrations rodam `up` e `down` sem erro.
- **SC-004**: CI verde e bloqueando merges com falha.
- **SC-005**: Todos os comandos de verificação do AGENTS.md passam.

## Fora do escopo

Canvas, workflows, execução, nós concretos e fila.

## Pré-requisitos humanos

- ADRs 0002–0004 confirmadas. Se não estiverem, o agente segue a proposta.
- Desejável: workflows de referência da POC exportados em `fixtures/n8n/`.

## Pontos em aberto

- ~~[PRECISA ESCLARECIMENTO: plataforma de CI — GitHub Actions ou GitLab CI?]~~ Resolvido em 03/10/2026: **GitHub Actions**.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 0 | Migração para SDD |
| 03/10/2026 | Status `Implementada`; sem mudança de comportamento. Desvios de plano registrados em [report.md](report.md) | Implementação da spec |
| 03/10/2026 | Ponto em aberto resolvido: CI no GitHub Actions | Decisão humana |
