# Autenticação

Como as pessoas entram no Olly Flow: **usuários locais** (e-mail e senha), sempre disponíveis, e o **login pelo IdP institucional** (OIDC), opcional. Introduzido na [spec 014](../specs/014-primeiro-usuario/spec.md), que atualizou a NFR-G03 e a [ADR-0005](adr/0005-autenticacao-oidc.md). Público: quem instala e administra a plataforma.

## Primeira subida

Numa instalação sem nenhum usuário, a tela de entrada mostra o **cadastro do primeiro usuário** (nome, e-mail e senha). Ele vira **administrador da plataforma** e entra direto. O cadastro é aceito uma única vez, inclusive com várias pessoas tentando ao mesmo tempo.

> **Atenção (risco aceito pelo PO, NFR-003):** não há código de instalação. Enquanto o primeiro usuário não for cadastrado, quem chegar primeiro à tela vira administrador. Cadastre-o logo depois de instalar, antes de expor a plataforma.

## Usuários locais

- **Entrada:** e-mail (sem diferença de maiúsculas) e senha. A mensagem de erro é sempre a mesma ("E-mail ou senha incorretos") e não revela se o e-mail existe.
- **Bloqueio:** depois de `OLLY_LOGIN_MAX_ATTEMPTS` (5) tentativas erradas seguidas, o usuário fica bloqueado por `OLLY_LOGIN_LOCK_MINUTES` (15). O bloqueio aparece na administração, e a redefinição de senha desbloqueia.
- **Sessão:** expira após `OLLY_SESSION_IDLE_MINUTES` (480) sem uso e, no máximo, `OLLY_SESSION_MAX_HOURS` (24) depois de aberta. "Sair" encerra a sessão. O token é opaco, guardado na API só como hash, e enviado como `Bearer`, como o token do IdP.
- **Política de senha:** no mínimo 12 caracteres, fora de uma lista de senhas comuns e sem a parte local do e-mail. Não há expiração periódica. Guardada só como hash scrypt (N=2^17, r=8, p=1, com sal por senha).
- **Troca de senha:** pelo menu "Trocar senha" (pede a atual). Encerra as outras sessões do usuário.

## Administração de usuários

Em **Administração › Usuários** (permissão `user:manage`):

- **Criar usuário local:** nome, e-mail e uma senha inicial, que o usuário troca obrigatoriamente no primeiro acesso.
- **Editar** nome e e-mail, **conceder ou retirar** a administração da plataforma, **desativar e reativar** (a desativação encerra as sessões na hora e preserva o histórico) e **redefinir a senha** (troca obrigatória no próximo acesso).
- **Listagem:** mostra a origem (local, IdP ou local + IdP), a situação (ativo, inativo, bloqueado, troca de senha pendente) e o último acesso.
- **Proteção:** a plataforma nunca fica sem ao menos um administrador ativo. Retirar a administração ou desativar o último é recusado, e a inativação automática por falta de uso (spec 009) preserva o administrador com acesso mais recente.
- **Projetos:** os usuários locais entram nos projetos como os demais (Projetos › membros); papéis e permissões valem igual.

## Login pelo IdP (opcional)

| Variável | Padrão | Efeito |
|---|---|---|
| `OLLY_IDP_ENABLED` | `false` | Com `true`, a tela mostra também "Entrar com conta institucional" e a API aceita os tokens do IdP |
| `OIDC_ISSUER_URL`, `OIDC_AUDIENCE` | — | Obrigatórias só com o IdP ativado |
| `OIDC_ADMIN_GROUP`, `OIDC_GROUPS_CLAIM` | `admin`, `groups` | Grupo de administração e claim de grupos (spec 009) |

- Com o IdP ativado, o login local continua valendo para todos os usuários locais.
- Os papéis vindos dos grupos do IdP (spec 009) só valem com ele ativado.
- A ativação é configuração da instalação: muda reiniciando a API, e cada mudança fica na auditoria (`auth.idp_config`).

**Vinculação:** quando alguém entra pelo IdP com o mesmo e-mail de um usuário local, as contas são vinculadas. A pessoa passa a entrar pelos dois caminhos, com os mesmos projetos. Isso só acontece se o IdP declarar o e-mail como **verificado** (claim `email_verified: true` no token); sem essa garantia, a entrada pelo IdP é recusada e auditada. No Keycloak a claim vem por padrão; em outros IdPs, inclua-a no access token.

## Recuperar o acesso

Se nenhum administrador consegue entrar, o operador do servidor cria um administrador local ou devolve o acesso a um:

```bash
# Docker
docker compose exec api node apps/api/dist/cli/users-admin.js --email ops@instituicao.gov.br --name "Operação"
# Desenvolvimento
pnpm --filter @olly/api users:admin --email ops@instituicao.gov.br
```

O comando imprime uma senha temporária uma única vez, a ser trocada no primeiro acesso. Ele também desbloqueia, ativa, dá a administração da plataforma, encerra as sessões abertas e registra `auth.admin_recovery` na auditoria.

### Instalações anteriores à spec 014

Instalações que só tinham usuários do IdP continuam funcionando com `OLLY_IDP_ENABLED=true`. Se o IdP for desativado, ninguém terá senha local: use o comando acima para criar o primeiro administrador local.

## Auditoria

`auth.setup`, `auth.local_login`, `auth.local_login_failed` (com o motivo só no detalhe), `auth.local_locked`, `auth.logout`, `auth.password_change`, `auth.password_reset`, `auth.idp_linked`, `auth.idp_link_refused`, `auth.admin_recovery`, `auth.idp_config`, `user.create`, `user.update`, `user.admin_grant`, `user.admin_revoke`, `user.activate`, `user.deactivate`. Nenhum registro contém senha.
