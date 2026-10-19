# Spec 026 — Ações da execução: excluir e ver o log

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 4 — Hardening (operação e depuração) |
| **Depende de** | 003, 005, 006, 008, 009 |
| **Requisitos de produto** | PR-07 (parcial), PR-19 (parcial), PR-20 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

A tela **Execuções** (spec 005, FR-013) lista as execuções, mas cada linha só abre o canvas somente leitura. Ao testar workflows grandes, o PO precisa:
- **ver o log** de uma execução de forma rápida e linear (cada nó executado, horário, status, duração, itens), filtrar, copiar e baixar, e chegar à subexecução de um "Executar workflow", como no modal de logs que a equipe já usa;
- **excluir** execuções que não interessam mais (testes, execuções com dados de teste), sem esperar a retenção (spec 009).

O PO pediu (19/10/2026) um botão de ações em cada execução já terminada, com **Excluir** e **Log**.

## Histórias de usuário

### HU-1 — Ver o log da execução (Prioridade: P1)

Como **quem acompanha execuções**, quero abrir o log de uma execução num modal, para entender o que aconteceu sem abrir o canvas.

**Teste independente:** executar um workflow, abrir o menu de ações da execução, escolher "Log" e conferir uma linha por nó executado, com horário, status, duração e itens.

**Cenários de aceite:**
1. **Dado** uma execução terminada, **quando** escolho "Log" no menu de ações, **então** abre um modal com o cabeçalho (identificador curto, workflow, status, modo, gatilho, início, fim e duração) e uma linha por execução de nó, na ordem em que executaram: horário com milissegundos, nome e tipo do nó, status, duração e itens de entrada → saída.
2. **Dado** um nó com erro, **quando** vejo o log, **então** a linha mostra a mensagem do erro. A falha geral da execução também aparece.
3. **Dado** o log aberto, **quando** escolho um status (todos, sucesso, erro, sem dados, aguardando, interrompido) ou digito no filtro, **então** só ficam as linhas que combinam. O texto procura no nome do nó, no tipo e na mensagem.
4. **Dado** o log, **quando** uso "Copiar", ".txt" ou ".json", **então** recebo as linhas filtradas como texto na área de transferência, como arquivo de texto ou como arquivo JSON.
5. **Dado** um nó "Executar workflow" que gerou uma subexecução, **quando** vejo o log, **então** a linha tem o link para a subexecução.
6. **Dado** o log, **quando** escolho "Abrir execução", **então** vou para a tela da execução (canvas somente leitura).

### HU-2 — Excluir uma execução (Prioridade: P1)

Como **editor**, quero excluir uma execução terminada, para limpar o histórico de testes e de dados que não devem ficar guardados.

**Teste independente:** escolher "Excluir" no menu de uma execução, confirmar e conferir que ela sumiu da lista e não pode mais ser aberta.

**Cenários de aceite:**
1. **Dado** uma execução terminada (sucesso, erro ou cancelada), **quando** escolho "Excluir" e confirmo, **então** a execução e todos os seus dados (nós, entrada e saída, arquivos, passos de IA, chamadas MCP, pedidos de aprovação) são removidos, e a lista é atualizada.
2. **Dado** uma execução na fila, em andamento ou aguardando, **quando** tento excluir, **então** a opção não aparece, e a API recusa (é preciso parar antes).
3. **Dado** um usuário sem a permissão de excluir execuções no projeto, **quando** abre o menu, **então** a opção "Excluir" não aparece, e a API recusa.
4. **Dado** uma exclusão, **quando** consulto a auditoria, **então** ela está registrada com quem excluiu, a execução e o workflow.

### Casos de borda

- **Subexecuções:** excluir a execução pai não exclui as subexecuções, que são execuções próprias; o vínculo com a pai deixa de levar a algum lugar.
- **Uso de IA:** o registro de tokens e custo (spec 011) fica: é contabilidade e cota do projeto, não histórico da execução.
- **Execução já excluída** (outra aba): a API responde "não encontrada", e a lista é atualizada.
- **Sem a permissão de ler dados** (`execution:readData`): o log mostra os metadados normalmente (não usa entrada e saída).

## Requisitos funcionais

- **FR-001**: Cada execução terminada na tela Execuções DEVE ter um botão de ações com **Log** e **Excluir**; Excluir só aparece com a permissão de excluir execuções do projeto.
- **FR-002**: O log DEVE abrir num modal com o cabeçalho da execução e uma linha por execução de nó (horário com milissegundos, nome, tipo, status, duração, itens de entrada → saída, mensagem de erro), na ordem de execução, e mostrar a falha geral da execução.
- **FR-003**: O log DEVE permitir filtrar por status e por texto (nome, tipo ou mensagem), copiar o texto, baixar em `.txt` e em `.json` (linhas filtradas) e abrir a tela da execução.
- **FR-004**: A linha de um nó que gerou subexecução DEVE ter o link para ela.
- **FR-005**: A exclusão DEVE pedir confirmação, só valer para execuções terminadas, remover a execução com todos os seus dados e registrar a ação na auditoria. Uma permissão nova controla a exclusão, concedida por padrão aos papéis administrador e editor.

## Requisitos não funcionais

- **NFR-001**: Interface em português do Brasil (NFR-G07).
- **NFR-002**: A exclusão não deixa dados da execução para trás (banco e armazenamento de objetos), como a retenção da spec 009.

## Entidades-chave

- **Execução:** passa a guardar também o nó que a criou, quando é uma subexecução.
- **Permissão `execution:delete`:** nova.

## Critérios de sucesso

- **SC-001**: Num workflow com um "Executar workflow" e um nó com erro, o log mostra todos os nós na ordem, o erro e o link para a subexecução, e os filtros, a cópia e os downloads trazem só as linhas filtradas.
- **SC-002**: Depois de excluir, a execução não aparece na lista, `GET /executions/:id` responde 404, e não sobram linhas nem objetos da execução.

## Fora do escopo

- Excluir várias execuções de uma vez.
- Log em tempo real de uma execução em andamento (o modal mostra o estado no momento em que abre).
- Desfazer a exclusão.

## Pré-requisitos humanos

- Nenhum.

## Pontos em aberto

Nenhum. Decisões tomadas na implementação (permissão nova para admin e editor; só execuções terminadas; uso de IA preservado) estão no plano e podem ser revistas pelo PO.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 19/10/2026 | Criação da spec, a pedido do PO (botão de ações na execução com "delete" e "log", com o modal de logs como referência), com implementação pedida diretamente | Testes com workflows grandes |
| 19/10/2026 | Implementação concluída ([relatório](report.md)) | — |
