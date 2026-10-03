# Documentação — Olly Flow

O projeto segue **Spec-Driven Development (SDD)**, com a estrutura inspirada no GitHub Spec Kit. O processo de trabalho (humanos e agentes de IA) está descrito no [`AGENTS.md`](../AGENTS.md).

## Mapa

```
AGENTS.md                         ← entrada para agentes de IA (CLAUDE.md aponta para ele)
.specify/
├── memory/constitution.md        ← princípios inegociáveis
└── templates/                    ← spec, plan, tasks, report
docs/
├── produto/visao.md              ← o quê e para quem; requisitos PR-xx; rastreabilidade
├── arquitetura/                  ← stack, contratos, visão geral, modelo de dados
├── adr/                          ← decisões de arquitetura
├── roadmap.md                    ← ordem das specs, status, pré-requisitos humanos
├── nos/ ...                      ← documentação por nó (gerada pelas specs)
├── estudos/                      ← análise original (não normativa)
└── _arquivo/                     ← documentos substituídos (não usar)
specs/
└── NNN-nome/
    ├── spec.md                   ← o quê e por quê (histórias, FR, SC)
    ├── plan.md                   ← como (design, contratos, dados, testes)
    ├── tasks.md                  ← checklist ordenado e rastreável
    └── report.md                 ← gerado ao final da implementação
```

## Rastreabilidade

```
PR-xx (produto) → FR-xxx (spec) → Txxx (tasks) → teste que cita o FR → report.md
```

## Por onde começar

| Você é | Leia |
|---|---|
| Gestão / PO | [visão de produto](produto/visao.md), [roadmap](roadmap.md), [ADRs](adr/README.md) |
| Tech lead | [constituição](../.specify/memory/constitution.md), [arquitetura](arquitetura/visao-geral.md), specs |
| Agente de IA | [`AGENTS.md`](../AGENTS.md) (ele indica a ordem de leitura) |
