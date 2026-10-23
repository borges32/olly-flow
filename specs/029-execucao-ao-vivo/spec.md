# Spec 029 — Acompanhamento ao vivo da execução

| Campo | Valor |
|---|---|
| **Status** | Planejada |
| **Fase** | 4 — Hardening (operação e depuração) |
| **Depende de** | 003, 005, 006, 009, 026 |
| **Requisitos de produto** | PR-07 (parcial), PR-20 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Os workflows de produção ficaram longos. Há fluxos com agentes de IA, consultas e chamadas HTTP que levam cerca de 5 minutos. Enquanto rodam, quem opera ou desenvolve tem pouca visibilidade:

- **Lista de execuções:** mostra só "Executando", sem dizer em que ponto o fluxo está.
- **Canvas da execução** (spec 005, FR-013):
  - é a única visão detalhada, mas foi feita para analisar depois, não para acompanhar;
  - recarrega o desenho inteiro enquanto a execução anda;
  - não mostra o nó que está rodando agora, só os que já terminaram;
  - num fluxo grande, obriga a procurar no desenho.
- **Log da execução** (spec 026): só existe para execuções terminadas.

Na prática, não dá para saber se o fluxo travou numa chamada externa, se está num laço demorado ou se está quase no fim. O problema aparece sobretudo nas execuções disparadas por webhook que chegam perto do tempo limite (o caso dos 504).

A plataforma já registra o início e o fim de cada nó durante a execução. Falta uma visão **simples, fora do canvas**, que mostre esses passos ao vivo.

## Histórias de usuário

### HU-1 — Acompanhar uma execução em andamento (Prioridade: P1)

Como **quem desenvolve ou opera workflows** (com `execution:read` no projeto), quero **abrir uma execução em andamento e ver ao vivo os passos já concluídos e o que está rodando agora, com os tempos**, para **saber em que ponto ela está, se travou e quanto já demorou**.

**Teste independente:** disparar um workflow com nós demorados (Esperar, HTTP lento), abrir o acompanhamento pela lista de execuções e ver cada nó aparecer como "em andamento" e depois "concluído", sem recarregar a página.

**Cenários de aceite:**
1. **Dado** uma execução em andamento na lista de execuções, **quando** escolho acompanhar, **então** vejo:
   - **cabeçalho:** o workflow, o modo, o gatilho, o início e o tempo decorrido, que corre a cada segundo;
   - **passos:** os já executados, na ordem em que começaram.
2. **Dado** o acompanhamento aberto, **quando** um nó começa, **então** ele aparece como "em andamento", com o tempo dele correndo, em até 2 segundos.
3. **Dado** um nó em andamento, **quando** ele termina, **então** o passo mostra o status (sucesso, erro, sem dados), a duração e os itens de entrada e saída.
4. **Dado** uma execução que já está no meio, **quando** abro o acompanhamento, **então** vejo todos os passos anteriores e os que estão rodando, sem perder nenhum.
5. **Dado** nós rodando em paralelo, **quando** acompanho, **então** todos aparecem "em andamento" ao mesmo tempo.
6. **Dado** um nó que falha, **quando** acompanho, **então** o passo fica destacado com a mensagem de erro, e o erro geral da execução aparece no topo.
7. **Dado** um nó **Esperar**, **quando** a execução fica aguardando, **então** o acompanhamento mostra "Aguardando", com o horário previsto de retomada, quando conhecido.
8. **Dado** o acompanhamento aberto, **quando** a execução termina, **então**:
   - mostra o status final e o tempo total;
   - para de atualizar;
   - oferece o Log (spec 026) e a execução no canvas.

### HU-2 — Acompanhar a partir do workflow (Prioridade: P2)

Como **quem desenvolve o workflow**, quero **ver no editor que há execuções dele em andamento e abrir o acompanhamento dali**, para **não precisar ir à lista de execuções e filtrar**.

**Teste independente:** com uma execução de produção em andamento, abrir o workflow no editor e ver o aviso "1 execução em andamento", que abre o acompanhamento.

**Cenários de aceite:**
1. **Dado** um workflow com execuções em andamento, **quando** abro o editor, **então** vejo quantas estão rodando, com acesso ao acompanhamento de cada uma.
2. **Dado** o aviso visível, **quando** a última execução termina, **então** o aviso some.

### HU-3 — Interromper pelo acompanhamento (Prioridade: P2)

Como **quem acompanha uma execução**, quero **interromper a execução pelo próprio acompanhamento**, para **agir assim que vejo que ela travou**.

**Cenários de aceite:**
1. **Dado** uma execução em andamento e a permissão de interromper (a mesma da lista de execuções), **quando** interrompo e confirmo, **então** a execução para, e os passos em andamento ficam "interrompido".
2. **Dado** um usuário sem essa permissão, **quando** acompanha, **então** a ação não aparece.

### Casos de borda

- **Conexão perdida:**
  - durante o acompanhamento, ela é retomada sozinha, com um aviso enquanto está fora;
  - ao voltar, os passos são ressincronizados, sem perder nem duplicar.
- **Fim enquanto a tela estava fechada:** ao abrir, a execução aparece como terminada, com todos os passos (igual ao Log).
- **Muitos passos:** num laço com milhares de iterações, o acompanhamento mostra uma linha por iteração, só as últimas 500, com o aviso do total (ponto 5). O navegador não trava.
- **Execução na fila** (spec 006): mostra "Na fila", até começar.
- **Worker perdido** (spec 006, FR-005): a execução aparece como terminada com erro, com o motivo.
- **Execução excluída** durante o acompanhamento (spec 026): aviso de que ela não existe mais.
- **Sub-workflow:** o passo do nó que chama o sub-workflow mostra o link para a subexecução, quando ela já existe.
- **Execução de teste** (pelo editor): é acompanhada como as de produção (ponto 4).
- **Muitas instâncias da API:** a execução roda num worker, e o usuário está conectado a qualquer instância; os passos chegam igual (spec 006, FR-003).

## Requisitos funcionais

- **FR-001**: O **Log** da execução (spec 026) DEVE funcionar também como acompanhamento ao vivo da execução na fila, em andamento ou aguardando (ponto 1). Ele DEVE ser acessível:
  - pela lista de execuções (ação "Acompanhar");
  - pelo editor (FR-015);
  - pelo link de uma subexecução (FR-011).
- **FR-002**: O acompanhamento DEVE mostrar no topo:
  - o workflow, a versão, o modo (teste ou produção) e o gatilho;
  - o início, o status e o tempo decorrido, atualizado a cada segundo.
- **FR-003**: O acompanhamento DEVE listar os passos na ordem de início, cada um com:
  - o nome e o tipo do nó;
  - a iteração, quando houver mais de uma;
  - o status: em andamento, sucesso, erro, sem dados, aguardando ou interrompido;
  - o início e a duração (correndo, nos passos em andamento);
  - os itens de entrada e de saída.
- **FR-004**: QUANDO um nó começa ou termina, o acompanhamento DEVE refletir a mudança em até 2 segundos, sem recarregar a página.
- **FR-005**: Ao abrir uma execução já começada, o acompanhamento DEVE mostrar todos os passos concluídos e os que estão em andamento.
- **FR-006**: QUANDO um nó falha, o passo DEVE aparecer destacado com a mensagem de erro, e o erro geral da execução DEVE aparecer no topo.
- **FR-007**: QUANDO a execução está aguardando (nó Esperar), o acompanhamento DEVE mostrar o status "Aguardando" e o horário previsto de retomada, quando conhecido.
- **FR-008**: QUANDO a execução termina, o acompanhamento DEVE:
  - mostrar o status final e o tempo total;
  - parar de atualizar;
  - dar acesso ao Log (spec 026) e à execução no canvas.
- **FR-009**: QUANDO a conexão cai, o acompanhamento DEVE:
  - avisar que está desconectado;
  - reconectar sozinho;
  - ressincronizar os passos, sem perder nem duplicar.
- **FR-010**: O acompanhamento DEVE mostrar um resumo do progresso: passos concluídos, passos em andamento e quantos nós do workflow já rodaram ao menos uma vez, sobre o total.
- **FR-011**: O passo de um nó que chama um sub-workflow DEVE ter o link para a subexecução, quando ela existir. O link DEVE abrir o acompanhamento dela, se ainda estiver ativa, ou o Log dela, se já terminou (ponto 6).
- **FR-012**: O acompanhamento DEVE exigir `execution:read` no projeto da execução; sem a permissão, a execução DEVE ser tratada como inexistente.
- **FR-013**: O acompanhamento NÃO DEVE mostrar os dados de entrada e saída dos nós, só os metadados. Os dados continuam no canvas da execução, com as regras de `execution:readData` (spec 005, FR-014).
- **FR-014**: Com a permissão de interromper execuções (a mesma da lista), o acompanhamento DEVE oferecer **Interromper**, com confirmação, nas execuções que a lista permite interromper (HU-3, ponto 3).
- **FR-015**: O editor do workflow DEVE indicar quantas execuções dele estão em andamento e dar acesso ao acompanhamento de cada uma (HU-2, ponto 2).
- **FR-016**: Num laço longo, o acompanhamento DEVE mostrar uma linha por iteração, limitada às últimas 500, com o aviso do total. O Log de uma execução terminada continua com todas as linhas (ponto 5).

## Requisitos não funcionais

- **NFR-001**: Atualização em até 2 segundos (p95) entre o início ou o fim de um nó no worker e a tela, com várias instâncias da API.
- **NFR-002**: O acompanhamento não pode pesar na API nem no banco proporcionalmente ao tamanho dos dados da execução. Uma execução com saídas grandes custa o mesmo que uma pequena.
- **NFR-003**: Com milhares de passos, a tela continua responsiva (FR-016).
- **NFR-004**: Os nomes dos nós e as mensagens de erro seguem o mascaramento da spec 009, como no Log.
- **NFR-005**: Interface em português do Brasil (NFR-G07), em celular e computador.

## Entidades-chave

- **Passo:** uma execução de um nó (nó + iteração), com o status, o início, a duração e os itens de entrada e saída. É o mesmo conceito da linha do Log da spec 026.
- **Acompanhamento:** a visão ao vivo de uma execução, com os passos e o resumo do progresso.

## Critérios de sucesso

- **SC-001**: Num workflow de cerca de 5 minutos, com nós Esperar e HTTP lentos, o acompanhamento mostra cada nó "em andamento" em até 2 segundos após o início e a duração final dele, sem recarregar a página.
- **SC-002**: Ao abrir o acompanhamento no meio da execução, todos os passos já concluídos aparecem, conferidos contra o Log ao final.
- **SC-003**: Com a conexão derrubada por 10 segundos no meio da execução, o acompanhamento avisa, volta sozinho e termina com os mesmos passos do Log.
- **SC-004**: Um usuário sem `execution:read` no projeto recebe "não encontrada"; um viewer com `execution:read` acompanha, sem ver dados de entrada nem de saída.

## Fora do escopo

- Dados de entrada e saída ao vivo, que continuam no canvas da execução.
- Mudanças no canvas de execução e no teste passo a passo do editor (spec 024).
- Notificação (e-mail, push) ao terminar.
- Painel com todas as execuções em andamento da plataforma (a lista de execuções com o filtro "Executando" cumpre esse papel).
- Subexecuções exibidas aninhadas no mesmo acompanhamento (só o link).
- Previsão do tempo restante.

## Pré-requisitos humanos

- ~~Responder aos pontos em aberto (PO)~~: respondidos em 23/10/2026.

## Pontos em aberto

Respondidos pelo PO em 23/10/2026, com as recomendações aceitas:

1. **Onde fica:** o modal de **Log** da spec 026 passa a funcionar também com a execução ativa (FR-001).
2. **Aviso no editor:** sim, "N execuções em andamento", com acesso ao acompanhamento (FR-015).
3. **Interromper:** sim, com a mesma permissão da lista de execuções (FR-014).
4. **Execuções de teste:** acompanhadas como as de produção.
5. **Laços longos:** uma linha por iteração, as últimas 500, com o aviso do total (FR-016).
6. **Link da subexecução:** abre o acompanhamento dela se estiver ativa, senão o Log dela (FR-011).

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 23/10/2026 | Criação da spec, a pedido do PO (acompanhar ao vivo as execuções em andamento, numa visão simples fora do canvas) | Workflows de produção longos (cerca de 5 minutos), sem visibilidade do ponto em que estão |
| 23/10/2026 | Pontos em aberto respondidos pelo PO (recomendações aceitas): Log da spec 026 ao vivo, aviso no editor, interromper, execuções de teste incluídas, últimas 500 iterações, link da subexecução. FR-016 novo. Plano e tarefas criados. Status: Planejada | Esclarecimento |
