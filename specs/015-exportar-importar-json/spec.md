# Spec 015 — Exportar e importar workflows em JSON (formato do Olly Flow e do N8N)

| Campo | Valor |
|---|---|
| **Status** | Implementada (pendente: SC-004 com um modelo de IA aprovado; workflows reais da POC) |
| **Fase** | 4 — Hardening (migração do N8N e criação de workflows assistida por IA) |
| **Depende de** | 002, 009, 011 |
| **Requisitos de produto** | PR-17, PR-15 (parcial), PR-18 (parcial), PR-19 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje um workflow só existe dentro da instalação em que foi criado. Não é possível:
- guardar uma cópia fora da plataforma, enviá-la a um colega ou levá-la para outra instalação (por exemplo, de homologação para produção);
- criar um workflow a partir de um arquivo, por exemplo um gerado por um modelo de IA a partir de uma descrição em linguagem natural;
- copiar nós de um workflow como texto e colá-los em outro workflow ou numa conversa;
- trazer os workflows da POC, feitos no N8N, sem refazê-los à mão.

No N8N, que os usuários da POC conhecem, isso é feito com **Download** e **Import from File** no menu do editor, e com copiar e colar nós, que vão para a área de transferência como JSON. O formato do N8N é conhecido por modelos de IA e documentado publicamente.

Esta spec traz essas operações para o Olly Flow, com um arquivo **o mais parecido possível com o do N8N**: mesma estrutura, mesmos nomes de campos e conexões pelo nome do nó, como no N8N. Mudam só os tipos e os parâmetros dos nós, que são os do Olly Flow. A mesma tela de importação aceita também os arquivos **exportados do N8N**: ela converte os nós suportados e preserva os demais como marcadores. Esse é o importador previsto na ADR-0001, que antes estava na spec 012 (HU-2). A spec também entrega a documentação do formato com o detalhe necessário para um modelo de IA gerar workflows válidos sem acesso ao código.

## Histórias de usuário

### HU-1 — Baixar o workflow como JSON (Prioridade: P1)

Como **editor ou administrador do projeto**, quero baixar um workflow como um arquivo JSON, para guardar uma cópia, compartilhá-la ou levá-la para outra instalação.

**Teste independente:** baixar um workflow com nós de todos os tipos e conferir que o arquivo segue o formato documentado e não contém nenhum segredo.

**Cenários de aceite:**
1. **Dado** um workflow aberto no editor, **quando** escolho "Baixar" no menu do workflow, **então** recebo um arquivo com o nome do workflow e o que está no canvas, inclusive as alterações ainda não salvas (como no N8N).
2. **Dado** a lista de workflows do projeto, **quando** escolho "Baixar" num workflow, **então** recebo o rascunho salvo.
3. **Dado** um nó com credencial, **quando** baixo o workflow, **então** o arquivo identifica a credencial (tipo e nome), mas nunca traz os dados dela.
4. **Dado** um workflow com dados fixados, **quando** baixo o workflow, **então** os dados fixados vão no arquivo, como no N8N.
5. **Dado** um usuário Executor ou Visualizador, **quando** ele abre o workflow ou a lista, **então** não há a opção de baixar, e a API recusa o pedido.

### HU-2 — Importar um JSON do Olly Flow (Prioridade: P1)

Como **editor**, quero importar um arquivo JSON do Olly Flow, ou colar o texto dele, num projeto, para reaproveitar um workflow de outra instalação ou um workflow gerado por IA, ou atualizar um workflow que já existe.

**Teste independente:** baixar um workflow, importá-lo em outro projeto e conferir que o resultado é equivalente ao original; importar os exemplos da documentação sem erros.

**Cenários de aceite:**
1. **Dado** um arquivo válido de um workflow que não existe no projeto, **quando** escolho "Importar" na lista de workflows, mantenho o formato "Olly Flow" e confirmo, **então** um novo workflow é criado como rascunho no projeto, sem publicar, com o nome do arquivo ou outro que eu informar.
2. **Dado** o arquivo de um workflow que já existe no projeto (o mesmo identificador ou, sem ele, o mesmo nome), **quando** peço a prévia, **então** ela avisa que o workflow será sobreposto; **quando** confirmo, **então** o rascunho desse workflow é substituído pelo conteúdo do arquivo como uma nova versão (o histórico é mantido), sem criar outro workflow e sem mudar a versão publicada.
3. **Dado** um arquivo carregado, **quando** ainda não confirmei, **então** vejo uma prévia: a quantidade de nós e conexões, os erros que impedem a importação e as pendências (credenciais a escolher, referências a revisar, avisos).
4. **Dado** um nó com credencial, **quando** importo, **então** o nó fica ligado à credencial correspondente do projeto, se houver uma só que corresponda. Senão, fica sem credencial e a pendência aparece na prévia.
5. **Dado** um arquivo com erro (JSON inválido, conexão para um nó inexistente, nome repetido), **quando** o carrego, **então** a importação é recusada e cada erro aparece com o nó e o motivo.
6. **Dado** um arquivo gerado por IA sem identificadores, sem posições ou sem alguns parâmetros, **quando** importo, **então** os identificadores são gerados, os nós são posicionados automaticamente e os parâmetros omitidos recebem o valor padrão do nó.
7. **Dado** um nó de tipo desconhecido, **quando** importo, **então** ele vira um nó marcador desabilitado, com o conteúdo original preservado, e o workflow não pode ser publicado até ele ser resolvido.

### HU-3 — Importar workflows exportados do N8N (Prioridade: P1)

Como **editor**, quero importar workflows exportados do N8N e receber um relatório do que precisa de ajuste, para migrar os workflows da POC sem refazê-los.

**Teste independente:** importar as fixtures do N8N, conferir o relatório e executar as que não têm pendências contra a saída esperada.

**Cenários de aceite:**
1. **Dado** um JSON exportado do N8N, **quando** escolho o formato "N8N" na importação, **então** a prévia mostra os nós convertidos, os com aviso, os não suportados, as expressões a revisar e as credenciais a cadastrar.
2. **Dado** uma importação confirmada, **quando** abro o workflow, **então** ele está como rascunho, com os nós não suportados destacados e desabilitados, e não pode ser publicado até eles serem resolvidos.
3. **Dado** um arquivo do N8N carregado com o formato "Olly Flow" (ou o contrário), **quando** peço a prévia, **então** ela recusa o arquivo e sugere o outro formato.

### HU-4 — Copiar e colar nós como JSON (Prioridade: P2)

Como **editor**, quero copiar nós do canvas como JSON no mesmo formato do arquivo e colar JSON no canvas, para mover trechos entre workflows e instalações ou usar um trecho gerado por IA.

**Teste independente:** copiar nós de um workflow, colar o texto num editor de texto para conferir o formato e depois colá-lo em outro workflow.

**Cenários de aceite:**
1. **Dado** nós selecionados, **quando** copio, **então** a área de transferência recebe o JSON com os nós e as conexões entre eles, no formato do arquivo.
2. **Dado** um JSON no formato do arquivo, completo ou só com os nós e as conexões, **quando** colo no canvas, **então** os nós são acrescentados ao workflow. Nomes repetidos ganham sufixo numérico, e as conexões acompanham os novos nomes.
3. **Dado** um texto que não é um JSON válido no formato, **quando** colo, **então** o canvas não muda e aparece uma mensagem com o motivo.

### HU-5 — Documentação do formato para pessoas e modelos de IA (Prioridade: P1)

Como **autor de workflows que usa um assistente de IA**, quero uma documentação do formato completa o bastante para que o modelo gere workflows válidos a partir de uma descrição em linguagem natural.

**Teste independente:** importar todos os exemplos da documentação sem erros e conferir que todo tipo de nó da plataforma está documentado.

**Cenários de aceite:**
1. **Dado** a documentação do formato em `docs/nos/`, **quando** um modelo de IA a recebe como contexto junto com um pedido, **então** ela traz tudo de que ele precisa para gerar um workflow importável: estrutura do arquivo, nós, conexões e portas, sub-nós, expressões, credenciais, parâmetros de cada tipo, regras de validação e exemplos completos.
2. **Dado** um tipo de nó novo na plataforma, **quando** a verificação automatizada roda, **então** ela falha se o tipo não estiver documentado.

### Casos de borda

- **Webhook com caminho já usado:** o rascunho é criado; o conflito aparece como aviso na prévia e só bloqueia a publicação, como hoje.
- **Referências de outra instalação:** o workflow chamado, o servidor MCP e o modelo de IA que não existem ou não estão acessíveis no destino são mantidos e listados como pendências; a publicação os acusa. Um workflow de erro inexistente é retirado das configurações, porque o salvamento o recusa, e a retirada aparece como pendência.
- **Tipo do N8N em versão não mapeada:** vira um nó marcador, com o conteúdo original preservado.
- **Arquivo de uma instalação mais nova** (versão do formato ou de um tipo de nó maior que a suportada): recusado com uma mensagem que cita a versão esperada. Versões anteriores continuam aceitas.
- **Conexão na saída de erro** de um nó que não está configurado para desviar os erros por ela: erro de importação.
- **Laços:** um ciclo fora das regras dos nós de laço é recusado, como no salvamento. No N8N, o retorno do laço chega à entrada do próprio nó de laço; a conversão o liga à entrada de continuação.
- **Conteúdo hostil** (estruturas que alteram objetos internos, textos enormes, aninhamento excessivo): recusado sem afetar a plataforma.
- **Workflow sem nós:** aceito; cria um rascunho vazio (ou sobrepõe o workflow correspondente com um rascunho vazio).
- **Arquivo de um workflow publicado:** a sobreposição muda só o rascunho; a produção continua na versão publicada até uma nova publicação, e a prévia avisa.
- **Arquivo de outro projeto ou de outra instalação:** o identificador não existe no destino; vale a correspondência pelo nome.
- **Nó marcador habilitado à mão:** ao executar, falha com uma mensagem que diz que o nó não é suportado.

## Requisitos funcionais

- **FR-001**: O arquivo DEVE seguir a estrutura do JSON de workflow do N8N, com os mesmos nomes de campos:
  - **envelope:** nome, nós, conexões, dados fixados, configurações, metadados, etiquetas e situação de ativo;
  - **nós:** identificador, nome, tipo, versão do tipo, posição, parâmetros, credenciais, desabilitado e opções de erro e de nova tentativa;
  - **conexões:** agrupadas pelo nome do nó de origem e pelo tipo de conexão (principal ou de sub-nó), com o índice da saída e, em cada destino, o nó, o tipo e o índice da entrada.
- **FR-002**: Os tipos e os parâmetros dos nós no arquivo DEVEM ser os do Olly Flow, sem conversão. As expressões DEVEM manter a sintaxe atual, que já é a do N8N.
- **FR-003**: Cada porta nomeada do Olly Flow DEVE corresponder a um índice fixo e documentado de saída ou de entrada (por exemplo, no If, verdadeiro = 0 e falso = 1). Isso inclui as portas que dependem dos parâmetros (Merge, Switch) e a saída de erro.
- **FR-004**: As configurações do Olly Flow sem equivalente no N8N DEVEM ser preservadas no arquivo sem alterar o significado dos campos do N8N.
- **FR-005**: O arquivo DEVE identificar a versão do formato. A importação DEVE aceitar a versão atual e as anteriores, e recusar as mais novas.
- **FR-006**: O editor DEVE permitir baixar o workflow pelo menu, com o conteúdo do canvas, inclusive as alterações não salvas. A lista de workflows DEVE permitir baixar o rascunho salvo. O arquivo DEVE ter o nome do workflow.
- **FR-007**: O arquivo baixado NÃO DEVE conter segredos: das credenciais, só a identificação (tipo, identificador e nome); valores sensíveis dos parâmetros também NÃO DEVEM sair.
- **FR-008**: Baixar um workflow DEVE exigir a permissão de editar o workflow (Editor e Admin do projeto) e DEVE ser auditado, sem registrar o conteúdo.
- **FR-009**: Os dados fixados DEVEM ir no arquivo baixado, como no N8N.
- **FR-010**: A lista de workflows do projeto DEVE permitir importar um arquivo JSON ou um texto colado, escolhendo o formato (Olly Flow ou N8N). QUANDO o arquivo corresponder a um workflow do projeto, a importação DEVE sobrepor o rascunho desse workflow como uma nova versão; senão, DEVE criar um novo workflow como rascunho. A importação NÃO DEVE publicar nem alterar a versão publicada.
- **FR-011**: Antes de confirmar, a importação DEVE mostrar uma prévia com a contagem de nós e conexões, os erros e as pendências. Com algum erro, a confirmação NÃO DEVE criar nada.
- **FR-012**: A importação DEVE aplicar as mesmas regras de validação do salvamento de um workflow, citando, para cada erro, o nó e o motivo.
- **FR-013**: QUANDO faltarem a um nó o identificador, a posição, a versão do tipo ou parte dos parâmetros, a importação DEVE gerar o identificador, posicionar o nó automaticamente, usar a versão instalada do tipo e preencher os parâmetros omitidos com o valor padrão do nó.
- **FR-014**: A importação NÃO DEVE criar credenciais. Cada credencial citada DEVE ser procurada no projeto de destino:
  1. pelo identificador, se a credencial for do mesmo tipo;
  2. senão, pelo nome e tipo, se houver uma única correspondência;
  3. senão, o nó fica sem credencial e a pendência aparece na prévia.
- **FR-015**: As referências a outros recursos que não existam, não estejam acessíveis ou estejam em conflito no destino DEVEM ser listadas como pendências, sem impedir a criação do rascunho. São elas: workflow chamado, workflow de erro, servidor MCP, modelo de IA e caminho de webhook.
- **FR-016**: Um nó de tipo desconhecido, ou de um tipo do N8N sem conversão para a sua versão, DEVE ser importado como nó marcador desabilitado, com o conteúdo original preservado e as conexões mantidas. A publicação DEVE ser bloqueada enquanto houver nós marcadores.
- **FR-017**: Importar DEVE exigir permissão para criar workflows no projeto e DEVE ser auditado. O registro traz o workflow criado, o formato, a contagem de nós e as pendências, sem o conteúdo.
- **FR-018**: A importação NÃO DEVE executar nada do arquivo (expressões, código ou chamadas externas) e DEVE tratá-lo como conteúdo não confiável, recusando arquivos acima dos limites ou com estruturas que alterem objetos internos.
- **FR-019**: Copiar nós no canvas DEVE colocar na área de transferência o JSON no formato do arquivo, com os nós selecionados e as conexões entre eles, sem segredos.
- **FR-020**: Colar no canvas um JSON no formato do arquivo, completo ou só com os nós e as conexões, DEVE acrescentar os nós ao workflow:
  - com as mesmas regras de conversão, credenciais e nós marcadores da importação;
  - com sufixo numérico nos nomes repetidos;
  - com as conexões atualizadas para os novos nomes.

  Um texto inválido NÃO DEVE alterar o canvas.
- **FR-021**: DEVE existir uma documentação do formato em `docs/nos/` que descreva:
  - a estrutura completa do arquivo, com conexões, portas, sub-nós, laços, saída de erro, credenciais, dados fixados e configurações;
  - todos os tipos de nó, com portas, credenciais aceitas e parâmetros (tipo, valores possíveis e padrão);
  - as expressões, as regras de validação, uma lista de verificação para quem gera o JSON e exemplos completos.
- **FR-022**: Uma verificação automatizada DEVE falhar se algum tipo de nó da plataforma não estiver na documentação, ou se algum exemplo completo da documentação não puder ser importado sem erros.
- **FR-023**: A importação no formato N8N DEVE converter os nós, as conexões (pelo nome, com as portas mapeadas) e os tipos conforme a tabela da ADR-0001, com uma conversão por tipo de nó e versão.
- **FR-024**: Na importação do N8N, as expressões DEVEM ser mantidas, e as construções divergentes ou não suportadas DEVEM ser marcadas para revisão.
- **FR-025**: Na importação do N8N, as credenciais NÃO DEVEM ser importadas. A prévia DEVE listar as credenciais a cadastrar e os nós que as usam, ligando os nós às credenciais do projeto que já correspondam pelo nome e tipo.
- **FR-026**: A importação do N8N DEVE gerar um relatório de migração na prévia: nós convertidos, com aviso e não suportados, expressões a revisar, credenciais a cadastrar e diferenças de comportamento.
- **FR-027**: Todos os workflows da POC exportados em `fixtures/n8n/` DEVEM ser importados, com o relatório consolidado. Os sem pendências DEVEM ser executados contra a saída esperada.
- **FR-028**: O workflow correspondente DEVE ser identificado pelo identificador do workflow no arquivo, se ele existir no projeto de destino; sem essa correspondência, por um único workflow do projeto com o mesmo nome. Com mais de um workflow com o mesmo nome, a importação DEVE criar um novo e avisar. A prévia DEVE informar qual workflow será sobreposto e como foi identificado, e sobrepor DEVE exigir a permissão de editar workflows.

## Requisitos não funcionais

- **NFR-001**: Ida e volta sem perda: exportar e importar um workflow produz uma definição equivalente (mesmos nós, parâmetros, conexões, configurações e dados fixados). As exceções são os identificadores gerados e as credenciais não encontradas.
- **NFR-002**: A importação tem limites configuráveis de tamanho do arquivo, quantidade de nós e profundidade, com padrões definidos no plano. Um arquivo acima do limite é recusado com uma mensagem que cita o limite.
- **NFR-003**: Nenhum segredo sai na exportação nem aparece nos logs ou na auditoria da exportação e da importação.
- **NFR-004**: A prévia de um workflow com 200 nós fica pronta em menos de 2 segundos.

## Entidades-chave

- **Arquivo de workflow**: JSON com a estrutura do N8N e os tipos e parâmetros do Olly Flow, com a versão do formato. É o mesmo conteúdo usado ao copiar e colar nós.
- **Prévia da importação**: resultado da validação de um arquivo antes de criar o workflow (contagens, erros, pendências, avisos e, no formato N8N, o relatório de migração).
- **Pendência de importação**: algo a resolver depois de importar, que não impede o rascunho: credencial não encontrada, referência inexistente, conflito de caminho de webhook ou nó marcador.
- **Nó marcador**: nó desabilitado que guarda um nó não suportado, com o conteúdo original, e bloqueia a publicação.

## Critérios de sucesso

- **SC-001**: Um workflow com todos os tipos de nó, baixado e importado em outro projeto, é equivalente ao original (NFR-001).
- **SC-002**: Nenhum segredo de credencial ou valor sensível aparece no arquivo baixado, na área de transferência, nos logs ou na auditoria (busca por valores sentinela).
- **SC-003**: Todos os exemplos completos da documentação são importados sem erros, e todo tipo de nó da plataforma está documentado.
- **SC-004**: Um modelo de IA, recebendo só a documentação e um pedido em linguagem natural, gera um JSON importável sem erros em pelo menos 8 de 10 pedidos de referência. Os pedidos cobrem webhook, If, Merge, laço e Agent com ferramentas.
- **SC-005**: Um arquivo inválido ou hostil é recusado com a lista de erros, sem criar nada e sem afetar a plataforma.
- **SC-006**: Nós copiados de um workflow e colados em outro, inclusive depois de passar por um editor de texto, mantêm os parâmetros e as conexões.
- **SC-007**: 100% dos workflows de `fixtures/n8n/` importados, com o relatório consolidado.
- **SC-008**: As fixtures do N8N sem pendências reproduzem a saída esperada.

## Fora do escopo

- Importar a partir de uma URL, como o "Import from URL" do N8N.
- Exportar ou importar vários workflows de uma vez, projetos inteiros, credenciais ou variáveis.
- Baixar uma versão específica do histórico.
- Exportar para o formato do N8N (o arquivo baixado é sempre o do Olly Flow).
- Sincronização com Git e promoção entre ambientes (backlog pós go-live).
- Gerar workflows por IA dentro da plataforma: esta spec entrega o formato e a documentação que tornam isso possível fora dela.

## Pré-requisitos humanos

- Todos os workflows da POC exportados em `fixtures/n8n/` (SC-007 e SC-008 valem para as fixtures presentes; hoje só há as sintéticas).
- Lista dos 10 pedidos de referência do SC-004 e acesso a um modelo de IA aprovado (ADR-0008) para a validação.

## Pontos em aberto

- Nenhum. (Respondidos pelo PO em 07/10/2026; ver o histórico.)

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 07/10/2026 | Criação | Pedido do PO: baixar e importar workflows em JSON nos moldes do N8N, com documentação do formato para modelos de IA |
| 07/10/2026 | Esclarecimentos respondidos pelo PO: (1) os tipos dos nós no arquivo são os atuais do Olly Flow; (2) os dados fixados sempre vão no arquivo baixado, como no N8N (FR-009; risco de LGPD aceito pelo PO); (3) o importador do N8N (HU-2 da spec 012, com os FR-005 a FR-010 e os SC-004 e SC-005 de lá) passa para esta spec como HU-3, FR-023 a FR-027, SC-007 e SC-008, com a escolha do formato na tela de importação (FR-010); (4) tipo desconhecido vira nó marcador desabilitado que bloqueia a publicação (FR-016); (5) só Editor e Admin do projeto baixam (FR-008). HU-3 e HU-4 anteriores renumeradas para HU-4 e HU-5; workflow de erro inexistente é retirado na importação (o salvamento o recusa) | Decisão humana |
| 07/10/2026 | Importar o JSON de um workflow que já existe no projeto sobrepõe o rascunho dele (nova versão, histórico mantido) em vez de criar outro: HU-2 (cenário 2), FR-010 alterado e FR-028 novo (correspondência pelo identificador e, sem ele, pelo nome único; aviso na prévia; permissão de editar) | Pedido do PO |
