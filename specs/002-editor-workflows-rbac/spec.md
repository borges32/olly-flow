# Spec 002 — Editor visual, workflows e RBAC por projeto

| Campo | Valor |
|---|---|
| **Status** | Verificada |
| **Fase** | 1 — MVP |
| **Depende de** | 001 |
| **Requisitos de produto** | PR-08, PR-15 |
| **ADRs relacionadas** | 0001 |

## Contexto e problema

Os usuários precisam montar workflows arrastando nós em um canvas, como no N8N, e editar os parâmetros de cada nó em um painel. O acesso precisa ser controlado por papéis dentro de **projetos**, para que cada área veja e altere apenas o que lhe cabe.

## Histórias de usuário

### HU-1 — Montar e salvar um workflow (P1)

Como **editor**, quero adicionar nós, conectá-los e configurar seus parâmetros em um canvas, para construir automações sem escrever código.

**Teste independente:** criar `Manual → Set`, salvar, recarregar e ver o mesmo workflow.

**Cenários de aceite:**
1. **Dado** um projeto em que sou editor, **quando** crio um workflow, adiciono nós pela paleta, conecto-os e salvo, **então** ao reabrir vejo o mesmo layout e os mesmos parâmetros.
2. **Dado** que duas pessoas editam o mesmo workflow, **quando** a segunda salva sobre uma versão desatualizada, **então** é avisada do conflito e pode recarregar.
3. **Dado** um workflow com ciclo ou conexão inválida, **quando** salvo, **então** vejo os erros destacados nos nós envolvidos.

### HU-2 — Controle de acesso por projeto (P1)

Como **administrador**, quero atribuir papéis a usuários em cada projeto para controlar quem cria, visualiza e executa workflows.

**Cenários de aceite:**
1. **Dado** um usuário visualizador, **quando** abre um workflow, **então** o canvas fica em modo somente leitura e qualquer alteração via API é negada.
2. **Dado** um usuário sem vínculo com o projeto, **quando** tenta acessar um workflow desse projeto, **então** o sistema responde como se o recurso não existisse.
3. **Dado** uma alteração em workflows, membros ou projetos, **quando** ela ocorre, **então** fica registrada na auditoria.

### HU-3 — Produtividade no editor (P2)

Como **editor**, quero desfazer e refazer, copiar e colar nós e usar atalhos, para editar com agilidade.

### Casos de borda

- Colar nós com nomes já existentes gera nomes únicos.
- Nó desabilitado repassa a entrada sem executar.
- Excluir um workflow não apaga o histórico de versões (*soft delete*).

## Requisitos funcionais

- **FR-001**: O sistema DEVE permitir criar, listar (paginado), abrir, salvar, renomear e excluir (*soft delete*) workflows dentro de um projeto.
- **FR-002**: Cada salvamento DEVE gerar uma nova versão do workflow, com a definição completa.
- **FR-003**: QUANDO um salvamento for feito sobre uma versão desatualizada, o sistema DEVE recusá-lo com conflito.
- **FR-004**: O sistema DEVE validar a estrutura do workflow ao salvar, rejeitando: conexões para nós ou portas inexistentes, nomes de nó duplicados e ciclos. Nós órfãos geram apenas aviso.
- **FR-005**: Os erros de validação DEVEM identificar os nós envolvidos.
- **FR-006**: O sistema DEVE expor o catálogo de tipos de nó (metadados, portas, schema de parâmetros) para o editor.
- **FR-007**: O canvas DEVE permitir adicionar (paleta com busca e categorias), mover, conectar, remover, ampliar e reduzir, enquadrar e navegar pelo minimapa.
- **FR-008**: O canvas DEVE oferecer desfazer/refazer, copiar/colar com nomes únicos, excluir por teclado, salvar por atalho e indicador de alterações não salvas.
- **FR-009**: O painel de parâmetros DEVE ser gerado automaticamente a partir do schema do nó, com exibição condicional de campos.
- **FR-010**: O sistema DEVE aplicar permissões por projeto: um administrador global tem acesso a tudo; os demais usuários têm as permissões do seu papel somente nos projetos dos quais são membros.
- **FR-011**: QUANDO um usuário sem vínculo acessar um recurso de outro projeto, o sistema DEVE responder 404.
- **FR-012**: Toda rota da API DEVE declarar a permissão exigida ou ser explicitamente pública. Um teste automatizado DEVE falhar se alguma rota não cumprir isso.
- **FR-013**: O sistema DEVE permitir gerenciar projetos e membros com seus papéis.
- **FR-014**: Alterações em projetos, membros e workflows DEVEM ser registradas na auditoria.
- **FR-015**: Usuários com apenas `workflow:read` DEVEM ver o canvas em modo somente leitura, sem ações de edição.
- **FR-016**: O motor DEVE executar workflows sequencialmente em ordem topológica, propagando itens entre portas. Nós desabilitados repassam a entrada.
- **FR-017**: O nó `trigger.manual` DEVE iniciar o workflow com os itens recebidos ou com um item vazio.
- **FR-018**: O nó `data.set` DEVE definir campos com valores fixos tipados, aceitar notação de ponto para campos aninhados e ter a opção de manter somente os campos definidos.

## Requisitos não funcionais

- **NFR-001**: O canvas permanece fluido (≥ 30 fps ao arrastar) com 100 nós.
- **NFR-002**: A UI esconde ações não permitidas, mas a autorização é sempre verificada na API.

## Entidades-chave

- **Workflow**: nome, projeto, situação (excluído ou não).
- **Versão de workflow**: definição completa (nós, conexões, configurações), autor e data.
- **Tipo de nó**: metadados e schema de parâmetros.

## Critérios de sucesso

- **SC-001**: E2E cria `Manual → Set`, salva, recarrega e confere o layout e os parâmetros.
- **SC-002**: O visualizador vê o canvas em modo somente leitura e a API retorna 403 ao editar.
- **SC-003**: Usuário fora do projeto recebe 404.
- **SC-004**: Teste de cobertura RBAC verde.
- **SC-005**: O motor executa `Manual → Set` (com campo aninhado) e produz os itens esperados.
- **SC-006**: Salvamento concorrente retorna 409.

## Fora do escopo

Expressões, execução pela UI, credenciais, nós de integração e publicação.

## Pré-requisitos humanos

Nenhum além da spec 001 verificada.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 1 | Migração para SDD |
| 03/10/2026 | Status `Implementada`; sem mudança de comportamento. Desvios de plano registrados em [report.md](report.md) | Implementação da spec |
