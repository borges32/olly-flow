# Spec 014 — Cadastro do primeiro usuário

| Campo | Valor |
|---|---|
| **Status** | Rascunho |
| **Fase** | 1 — MVP (apoio à validação de UX) |
| **Depende de** | 002 |
| **Requisitos de produto** | PR-08 (parcial), PR-20 (parcial); afeta NFR-G03 |
| **ADRs relacionadas** | 0005 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Numa instalação nova do Olly Flow não há nenhum usuário na plataforma. Hoje, o único caminho de entrada é uma conta já existente no provedor de identidade (IdP), e o administrador global é quem pertence ao grupo de administração desse IdP. Quem abre a plataforma pela primeira vez — por exemplo, para validar a UX do editor com usuários da POC — vê apenas "Entrar com conta institucional" e não sabe com qual conta entrar, nem como se tornar administrador para criar projetos e convidar as demais pessoas.

O N8N resolve isso com a configuração do "proprietário" no primeiro acesso. O Olly Flow precisa de um caminho equivalente para o primeiro acesso, sem enfraquecer a governança exigida pela instituição (login institucional, auditoria, RBAC).

## Histórias de usuário

### HU-1 — Cadastrar o primeiro usuário numa instalação nova (P1)

Como **primeira pessoa a acessar uma instalação nova**, quero **cadastrar o primeiro usuário pela própria tela de entrada** para **conseguir entrar e configurar a plataforma sem depender de outra equipe**.

**Teste independente:** em uma instalação sem usuários, abrir a plataforma, cadastrar o primeiro usuário, entrar e criar um projeto.

**Cenários de aceite:**
1. **Dado** uma instalação sem nenhum usuário, **quando** abro a tela de entrada, **então** vejo a opção de cadastrar o primeiro usuário.
2. **Dado** que cadastrei o primeiro usuário, **quando** entro, **então** chego à tela inicial como administrador global e consigo criar projetos.
3. **Dado** que já existe ao menos um usuário, **quando** abro a tela de entrada, **então** a opção de cadastro não aparece.
4. **Dado** que já existe ao menos um usuário, **quando** alguém tenta cadastrar outro "primeiro usuário" diretamente pela API, **então** a operação é recusada.

### HU-2 — Controlar onde o cadastro inicial é permitido (P1)

Como **responsável pela plataforma**, quero **habilitar ou desabilitar o cadastro inicial por ambiente** para **que ambientes com login exclusivamente institucional não ofereçam esse caminho**.

**Cenários de aceite:**
1. **Dado** um ambiente com o cadastro inicial desabilitado, **quando** não há usuários, **então** a tela de entrada não oferece o cadastro e explica como obter acesso.

### Casos de borda

- Duas pessoas tentam cadastrar o primeiro usuário ao mesmo tempo: só uma consegue; a outra é informada de que a instalação já foi configurada.
- A instalação é zerada (banco apagado) depois de configurada: a opção volta a aparecer, desde que habilitada.
- O e-mail informado já existe no IdP. [PRECISA ESCLARECIMENTO: vincular à conta existente ou recusar?]

## Requisitos funcionais

- **FR-001**: QUANDO não houver nenhum usuário na plataforma e o cadastro inicial estiver habilitado, a tela de entrada DEVE oferecer o cadastro do primeiro usuário.
- **FR-002**: O cadastro do primeiro usuário DEVE ser aceito uma única vez. Com ao menos um usuário existente, NÃO DEVE ser oferecido nem aceito, inclusive em requisições simultâneas.
- **FR-003**: O primeiro usuário DEVE receber administração global.
- **FR-004**: O cadastro DEVE coletar nome, e-mail e senha. [PRECISA ESCLARECIMENTO: onde a credencial é criada — como conta no IdP (mantendo o login exclusivamente via OIDC) ou como credencial local da plataforma (o que altera a NFR-G03)?]
- **FR-005**: Após o cadastro, o usuário DEVE conseguir entrar com as credenciais cadastradas e chegar à tela inicial.
- **FR-006**: O cadastro inicial DEVE poder ser habilitado ou desabilitado por ambiente. [PRECISA ESCLARECIMENTO: em quais ambientes fica habilitado — só desenvolvimento/testes de UX, também homologação, ou produção?]
- **FR-007**: O cadastro do primeiro usuário DEVE ser registrado na auditoria.
- **FR-008**: Com o cadastro desabilitado e sem usuários, a tela de entrada DEVE orientar como obter acesso.

## Requisitos não funcionais

- **NFR-001**: A senha DEVE seguir uma política mínima. [PRECISA ESCLARECIMENTO: política da instituição (tamanho, complexidade) ou a do IdP?]
- **NFR-002**: O cadastro inicial NÃO DEVE permitir que um terceiro "tome" uma instalação recém-publicada. [PRECISA ESCLARECIMENTO: exigir um código de instalação visível apenas a quem opera o servidor (por exemplo, no log da subida)?]
- **NFR-003**: Nenhuma senha em logs, respostas da API ou registros de auditoria.

## Entidades-chave

- **Instalação**: estado da plataforma quanto à configuração inicial (sem usuários / configurada).
- **Primeiro usuário**: a conta criada pelo cadastro inicial, com administração global.

## Critérios de sucesso

- **SC-001**: Em uma instalação zerada, uma pessoa sem orientação prévia cadastra o primeiro usuário, entra e cria um projeto em menos de 3 minutos.
- **SC-002**: Com um usuário existente, nem a UI nem a API aceitam um novo cadastro inicial.
- **SC-003**: Com o cadastro desabilitado, a opção não aparece em nenhuma circunstância.

## Fora do escopo

- Cadastro aberto de outros usuários (autocadastro), convites e recuperação de senha.
- Sincronização de usuários e grupos com o diretório institucional (spec 009).
- Alterar o login das contas institucionais existentes.

## Pré-requisitos humanos

- Decisão do PO e da Segurança sobre a relação com a **NFR-G03** ("login exclusivamente via provedor de identidade institucional"). Se a credencial for local, a NFR-G03 e a visão de produto precisam ser alteradas antes do planejamento.
- Resolver os `[PRECISA ESCLARECIMENTO]` desta spec.

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: onde a credencial do primeiro usuário é criada — no IdP ou localmente na plataforma? (FR-004)]
- [PRECISA ESCLARECIMENTO: em quais ambientes o cadastro inicial fica habilitado? (FR-006)]
- [PRECISA ESCLARECIMENTO: e-mail já existente no IdP — vincular ou recusar? (casos de borda)]
- [PRECISA ESCLARECIMENTO: política de senha (NFR-001)]
- [PRECISA ESCLARECIMENTO: exigir código de instalação para evitar tomada da instalação? (NFR-002)]
- [PRECISA ESCLARECIMENTO: o primeiro usuário convive com o grupo de administração do IdP (`OIDC_ADMIN_GROUP`) ou o substitui como fonte de administração global?]

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação | Pedido do usuário após testar a UX com a instalação zerada: não havia caminho para o primeiro acesso |
