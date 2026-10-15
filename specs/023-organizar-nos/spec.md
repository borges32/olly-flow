# Spec 023 — Organizar os nós do workflow ("Tidy up")

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 4 — Hardening (paridade com o N8N, apoio à UX) |
| **Depende de** | 002, 011 |
| **Requisitos de produto** | PR-15 (parcial), PR-17 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Workflows grandes, especialmente os importados do N8N ou montados aos poucos, ficam com nós sobrepostos, arestas cruzadas e sub-nós de IA espalhados. Reorganizar à mão leva tempo e quebra o fluxo de trabalho.

O N8N tem o botão **Tidy up** (atalho Shift+Alt+T). Ele reorganiza os nós da esquerda para a direita, na ordem do fluxo, com os sub-nós (modelo, memória, ferramentas) embaixo do nó pai, e pode ser desfeito. O PO pediu (15/10/2026) o mesmo recurso no Olly Flow.

## Histórias de usuário

### HU-1 — Organizar o workflow com um clique (Prioridade: P1)

Como **editor**, quero um botão que organiza os nós do workflow, para entender e manter workflows grandes sem arrumar o canvas à mão.

**Teste independente:** abrir um workflow com nós sobrepostos, clicar em "Organizar" e conferir os nós sem sobreposição, na ordem do fluxo, e o desfazer.

**Cenários de aceite:**
1. **Dado** um workflow com nós desordenados, **quando** clico em "Organizar", **então** os nós ficam da esquerda para a direita na ordem das conexões, sem sobreposição, e o canvas enquadra o resultado.
2. **Dado** um nó com várias saídas (If, Switch), **quando** organizo, **então** os ramos ficam empilhados à direita dele, sem nós sobrepostos.
3. **Dado** um Agent ou um Basic LLM Chain com sub-nós (modelo, memória, ferramentas, output parser), **quando** organizo, **então** os sub-nós ficam embaixo do nó pai, lado a lado, como no N8N, inclusive os sub-nós de sub-nós.
4. **Dado** um laço (Loop Over Items, While), **quando** organizo, **então** a organização termina e o laço continua legível.
5. **Dado** a organização feita, **quando** desfaço (Ctrl+Z), **então** os nós voltam às posições anteriores num só passo.
6. **Dado** o atalho Shift+Alt+T, **quando** o uso no canvas, **então** o efeito é o mesmo do botão.

### HU-2 — Organizar só uma parte (Prioridade: P2)

Como **editor**, quero organizar só os nós selecionados, para arrumar um trecho sem mexer no resto.

**Teste independente:** selecionar alguns nós, organizar e conferir que só eles mudaram.

**Cenários de aceite:**
1. **Dado** dois ou mais nós selecionados, **quando** organizo, **então** só eles (e os sub-nós deles) mudam de lugar, na região onde estavam.
2. **Dado** nenhum ou um nó selecionado, **quando** organizo, **então** o workflow inteiro é organizado.

### Casos de borda

- **Workflow vazio ou com um nó:** o botão não muda nada.
- **Partes desconectadas** (dois fluxos independentes, nós soltos): cada parte é organizada, sem sobreposição entre elas.
- **Somente leitura** (versão antiga, sem permissão de editar, execução aberta): o botão fica indisponível.
- **Posição:** o canto superior esquerdo dos nós organizados fica onde estava, para o workflow não "pular" no canvas.

## Requisitos funcionais

- **FR-001**: O editor DEVE oferecer o botão "Organizar" e o atalho Shift+Alt+T, que reposicionam os nós da esquerda para a direita na ordem das conexões, sem sobreposição, e enquadram o resultado no canvas.
- **FR-002**: Os sub-nós DEVEM ficar embaixo do nó pai, lado a lado, na ordem das entradas do pai, inclusive os sub-nós de sub-nós.
- **FR-003**: Com dois ou mais nós selecionados, a organização DEVE valer só para eles e os sub-nós deles; sem seleção (ou com um nó), para o workflow inteiro.
- **FR-004**: A organização DEVE manter o canto superior esquerdo dos nós organizados, terminar com laços e partes desconectadas, e usar o tamanho real dos nós no canvas.
- **FR-005**: A organização DEVE ser desfeita num só passo e marcar o workflow como alterado (não salvo). Na tela somente leitura, NÃO DEVE estar disponível.

## Requisitos não funcionais

- **NFR-001**: Organizar um workflow de 100 nós leva menos de 1 segundo.
- **NFR-002**: Interface em português do Brasil (NFR-G07).

## Entidades-chave

Nenhuma nova: só as posições dos nós mudam.

## Critérios de sucesso

- **SC-001**: Num workflow com If, Merge, laço e um Agent com sub-nós, depois de organizar: nenhum par de nós se sobrepõe, cada conexão principal vai da esquerda para a direita (exceto o retorno do laço), e os sub-nós ficam embaixo do pai.
- **SC-002**: Ctrl+Z depois de organizar devolve todas as posições anteriores.

## Fora do escopo

- Organização automática ao importar ou ao salvar (continua manual, pelo botão).
- Escolher a direção (só da esquerda para a direita, como no N8N).

## Pré-requisitos humanos

- Nenhum.

## Pontos em aberto

Nenhum. Escopo da seleção, atalho e desfazer seguem o Tidy up do N8N.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 15/10/2026 | Criação da spec, a pedido do PO ("botão que organiza os nós do workflow, como no N8N"), com implementação pedida diretamente | Paridade com o N8N e workflows grandes |
| 15/10/2026 | Implementação concluída ([relatório](report.md)) | — |
