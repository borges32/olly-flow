# AGENTS.md — Olly Flow

> Ponto de entrada para **qualquer agente de IA** que trabalhe neste repositório. Leia este arquivo inteiro antes de agir.

## O projeto

O **Olly Flow** é uma plataforma interna de automação de workflows visuais com IA, inspirada no N8N e compatível conceitualmente com ele ([ADR-0001](docs/adr/0001-abordagem-hibrida.md)). O desenvolvimento segue **Spec-Driven Development (SDD)**: nenhuma linha de código é escrita sem uma especificação aprovada que a justifique.

## Mapa da documentação (fontes de verdade)

| Ordem de leitura | Documento | Papel |
|---|---|---|
| 1 | [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | Princípios inegociáveis. **Prevalece sobre tudo** |
| 2 | [`docs/produto/visao.md`](docs/produto/visao.md) | Visão, usuários, requisitos de produto (PR-xx) e rastreabilidade |
| 3 | [`docs/arquitetura/`](docs/arquitetura/) | Stack, estrutura, contratos, modelo de dados, catálogo de nós |
| 4 | [`docs/adr/`](docs/adr/) | Decisões de arquitetura |
| 5 | [`docs/roadmap.md`](docs/roadmap.md) | Ordem das specs, status e pré-requisitos humanos |
| 6 | `specs/NNN-*/spec.md` → `plan.md` → `tasks.md` | O que construir, como e em que ordem |
| 7 | `specs/NNN-*/report.md` das specs anteriores | O que já foi feito, desvios e decisões |

**Precedência em caso de conflito:** constituição > ADR aceita > `spec.md` > `plan.md` > `tasks.md` > ADR proposta > estudos. Registre todo conflito no `report.md`.

`docs/estudos/` contém a análise original (contexto histórico, não normativo). `docs/_arquivo/` contém documentos substituídos: **não use como fonte**.

## Ciclo SDD

```
Especificar (spec.md) → Esclarecer → Planejar (plan.md) → Quebrar em tarefas (tasks.md) → Implementar → Verificar → Relatar (report.md)
```

| Etapa | Quem | Artefato | Status da spec |
|---|---|---|---|
| Especificar | Humano + IA | `spec.md`: o **quê** e o **porquê**, sem detalhes de implementação | `Rascunho` |
| Esclarecer | Humano | Resolver todos os `[PRECISA ESCLARECIMENTO]` | `Rascunho` |
| Planejar | IA, revisado por humano | `plan.md`: o **como** (design, contratos, dados, testes) | `Planejada` |
| Tarefas | IA, revisado por humano | `tasks.md`: checklist ordenado e rastreável | `Aprovada` |
| Implementar | IA | Código + testes; marca `[x]` em `tasks.md` | `Em implementação` |
| Verificar e relatar | IA, depois revisão humana | `report.md` | `Implementada` → `Verificada` (após revisão humana) |

As specs 001 a 013 já estão escritas até a etapa **Tarefas**. O próximo passo de cada uma é **Implementar**, assim que os pré-requisitos do roadmap forem atendidos.

## Como implementar uma spec

Prompt de disparo (uma spec por sessão):

```text
Implemente a spec specs/NNN-<nome>/ seguindo o AGENTS.md.
```

Procedimento obrigatório:

1. Leia os documentos na ordem do mapa acima e o `report.md` da spec anterior.
2. Confira em `docs/roadmap.md` se a spec está `Aprovada` e se os pré-requisitos humanos foram atendidos. Se não estiverem, **pare** e informe o que falta.
3. Se houver `[PRECISA ESCLARECIMENTO]` não resolvido que bloqueie uma tarefa, não invente: implemente o restante e registre o bloqueio.
4. Rode os comandos de verificação (abaixo) para confirmar que o ponto de partida está verde.
5. Execute as tarefas de `tasks.md` **na ordem**. Tarefas marcadas `[P]` podem ser feitas em paralelo. Ao concluir uma tarefa, marque `- [x]`.
6. Cada requisito (`FR-xxx`) precisa de pelo menos um teste automatizado que o comprove. Cite o ID do requisito no nome ou descrição do teste.
7. Se a implementação exigir mudar o comportamento especificado, **atualize `spec.md`/`plan.md` primeiro** (seção "Histórico de alterações") e registre no relatório. Código e spec nunca divergem.
8. Ao final, rode a verificação completa e escreva `specs/NNN-*/report.md` a partir de [`.specify/templates/report-template.md`](.specify/templates/report-template.md).
9. Atualize o status da spec no cabeçalho de `spec.md` e em `docs/roadmap.md`.

Para retomar uma spec incompleta: `Conclua as tarefas pendentes da spec specs/NNN-<nome>/ (ver tasks.md e report.md), seguindo o AGENTS.md.`

## Como criar uma spec nova (pós go-live ou mudança de escopo)

1. Crie `specs/NNN-nome-curto/` com o próximo número.
2. Copie [`spec-template.md`](.specify/templates/spec-template.md) para `spec.md` e preencha **sem** decisões de implementação, marcando dúvidas com `[PRECISA ESCLARECIMENTO: ...]`.
3. Após o esclarecimento humano, gere `plan.md` e `tasks.md` a partir dos templates.
4. Adicione a spec ao `docs/roadmap.md` e à matriz de rastreabilidade de `docs/produto/visao.md`.

## Comandos de verificação

Precisam passar ao final de toda spec. Disponíveis a partir da spec 001; os comandos E2E, a partir da 002.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test               # unidade
pnpm test:integration   # integração (Testcontainers)
pnpm build
pnpm test:e2e           # Playwright
docker compose up -d && pnpm smoke
```

Se algum comando falhar e você não conseguir corrigir, a spec **não** está implementada. Registre a saída do erro no `report.md`.

## Regras rápidas (detalhes na constituição)

- Não implemente nada fora do escopo da spec. Sugestões vão para "Próximos passos" no relatório.
- Código e expressões de usuário só rodam em sandbox. SQL só parametrizado. Segredos nunca em logs ou respostas.
- Toda rota da API declara permissão RBAC.
- Decisões institucionais (ADRs 0005–0008) não são suas: use adapter + implementação local e registre a pendência.
- Nova dependência exige justificativa no relatório.
