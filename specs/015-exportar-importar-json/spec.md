# Spec 015 — Exportar e importar workflows em JSON (formato do N8N)

| Campo | Valor |
|---|---|
| **Status** | Aprovado |
| **Fase** | 4 — Hardening (apoio à migração e à criação de workflows assistida por IA) |
| **Depende de** | 002, 009, 011 |
| **Requisitos de produto** | PR-17 (parcial), PR-15 (parcial), PR-18 (parcial), PR-19 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje um workflow só existe dentro da instalação em que foi criado. Não é possível:
- guardar uma cópia fora da plataforma, enviá-la a um colega ou levá-la para outra instalação (por exemplo, de homologação para produção);
- criar um workflow a partir de um arquivo, por exemplo um gerado por um modelo de IA a partir de uma descrição em linguagem natural;
- copiar nós de um workflow como texto e colá-los em outro workflow ou numa conversa.

No N8N, que os usuários da POC conhecem, isso é feito com **Download** e **Import from File** no menu do editor, e com copiar e colar nós, que vão para a área de transferência como JSON. O formato do N8N é conhecido por modelos de IA e documentado publicamente.

Esta spec traz essas operações para o Olly Flow, com um arquivo **o mais parecido possível com o do N8N**: mesma estrutura, mesmos nomes de campos e conexões pelo nome do nó, como no N8N. Mudam só os tipos e os parâmetros dos nós, que são os do Olly Flow. A spec também entrega a documentação do formato com o detalhe necessário para um modelo de IA gerar workflows válidos sem acesso ao código.

A conversão de arquivos **exportados do N8N** (tipos e parâmetros do N8N) continua sendo o importador da [spec 012](../012-observabilidade-importador-homologacao/spec.md) (HU-2).

## Histórias de usuário

### HU-1 — Baixar o workflow como JSON (Prioridade: P1)

Como **usuário com acesso ao workflow**, quero baixá-lo como um arquivo JSON, para guardar uma cópia, compartilhá-la ou levá-la para outra instalação.

**Teste independente:** baixar um workflow com nós de todos os tipos e conferir que o arquivo segue o formato documentado e não contém nenhum segredo.

**Cenários de aceite:**
1. **Dado** um workflow aberto no editor, **quando** escolho "Baixar" no menu do workflow, **então** recebo um arquivo com o nome do workflow e o que está no canvas, inclusive as alterações ainda não salvas (como no N8N).
2. **Dado** a lista de workflows do projeto, **quando** escolho "Baixar" num workflow, **então** recebo o rascunho salvo.
3. **Dado** um nó com credencial, **quando** baixo o workflow, **então** o arquivo identifica a credencial (tipo e nome), mas nunca traz os dados dela.
4. **Dado** um workflow com dados fixados, **quando** baixo o workflow, **então** eles seguem a regra de LGPD definida nos pontos em aberto.

### HU-2 — Importar um JSON como novo workflow (Prioridade: P1)

Como **editor**, quero importar um arquivo JSON, ou colar o texto dele, como um novo workflow num projeto, para reaproveitar um workflow de outra instalação ou um workflow gerado por IA.

**Teste independente:** baixar um workflow, importá-lo em outro projeto e conferir que o resultado é equivalente ao original; importar os exemplos da documentação sem erros.

**Cenários de aceite:**
1. **Dado** um arquivo válido, **quando** escolho "Importar" na lista de workflows e confirmo, **então** um novo workflow é criado como rascunho no projeto, sem publicar, com o nome do arquivo ou outro que eu informar.
2. **Dado** um arquivo carregado, **quando** ainda não confirmei, **então** vejo uma prévia: a quantidade de nós e conexões, os erros que impedem a importação e as pendências (credenciais a escolher, referências a revisar, avisos).
3. **Dado** um nó com credencial, **quando** importo, **então** o nó fica ligado à credencial correspondente do projeto, se houver uma só que corresponda. Senão, fica sem credencial e a pendência aparece na prévia.
4. **Dado** um arquivo com erro (JSON inválido, tipo de nó desconhecido, conexão para um nó inexistente, nome repetido), **quando** o carrego, **então** a importação é recusada e cada erro aparece com o nó e o motivo.
5. **Dado** um arquivo gerado por IA sem identificadores, sem posições ou sem alguns parâmetros, **quando** importo, **então** os identificadores são gerados, os nós são posicionados automaticamente e os parâmetros omitidos recebem o valor padrão do nó.

### HU-3 — Copiar e colar nós como JSON (Prioridade: P2)

Como **editor**, quero copiar nós do canvas como JSON no mesmo formato do arquivo e colar JSON no canvas, para mover trechos entre workflows e instalações ou usar um trecho gerado por IA.

**Teste independente:** copiar nós de um workflow, colar o texto num editor de texto para conferir o formato e depois colá-lo em outro workflow.

**Cenários de aceite:**
1. **Dado** nós selecionados, **quando** copio, **então** a área de transferência recebe o JSON com os nós e as conexões entre eles, no formato do arquivo.
2. **Dado** um JSON no formato do arquivo, completo ou só com os nós e as conexões, **quando** colo no canvas, **então** os nós são acrescentados ao workflow. Nomes repetidos ganham sufixo numérico, e as conexões acompanham os novos nomes.
3. **Dado** um texto que não é um JSON válido no formato, **quando** colo, **então** o canvas não muda e aparece uma mensagem com o motivo.

### HU-4 — Documentação do formato para pessoas e modelos de IA (Prioridade: P1)

Como **autor de workflows que usa um assistente de IA**, quero uma documentação do formato completa o bastante para que o modelo gere workflows válidos a partir de uma descrição em linguagem natural.

**Teste independente:** importar todos os exemplos da documentação sem erros e conferir que todo tipo de nó da plataforma está documentado.

**Cenários de aceite:**
1. **Dado** a documentação do formato em `docs/nos/`, **quando** um modelo de IA a recebe como contexto junto com um pedido, **então** ela traz tudo de que ele precisa para gerar um workflow importável: estrutura do arquivo, nós, conexões e portas, sub-nós, expressões, credenciais, parâmetros de cada tipo, regras de validação e exemplos completos.
2. **Dado** um tipo de nó novo na plataforma, **quando** a verificação automatizada roda, **então** ela falha se o tipo não estiver documentado.

### Casos de borda

- **Webhook com caminho já usado:** o rascunho é criado; o conflito aparece como aviso na prévia e só bloqueia a publicação, como hoje.
- **Referências de outra instalação** (workflow chamado, workflow de erro, servidor MCP, modelo de IA) que não existem ou não estão acessíveis no projeto de destino: são mantidas e listadas como pendências; a publicação as acusa.
- **Arquivo exportado pelo N8N:** recusado com a orientação de usar o importador do N8N (spec 012).
- **Arquivo de uma instalação mais nova** (versão do formato ou de um tipo de nó maior que a suportada): recusado com uma mensagem que cita a versão esperada. Versões anteriores continuam aceitas.
- **Conexão na saída de erro** de um nó que não está configurado para desviar os erros por ela: erro de importação.
- **Laços:** um ciclo fora das regras dos nós de laço é recusado, como no salvamento.
- **Conteúdo hostil** (estruturas que alteram objetos internos, textos enormes, aninhamento excessivo): recusado sem afetar a plataforma.
- **Workflow sem nós:** aceito; cria um rascunho vazio.

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
- **FR-008**: Baixar um workflow DEVE exigir permissão para vê-lo e DEVE ser auditado, sem registrar o conteúdo.
- **FR-009**: Os dados fixados DEVEM seguir, na exportação, a regra definida nos pontos em aberto (LGPD).
- **FR-010**: A lista de workflows do projeto DEVE permitir importar um arquivo JSON ou um texto colado, criando um novo workflow como rascunho no projeto. O workflow importado NÃO DEVE ser publicado pela importação.
- **FR-011**: Antes de confirmar, a importação DEVE mostrar uma prévia com a contagem de nós e conexões, os erros e as pendências. Com algum erro, a confirmação NÃO DEVE criar nada.
- **FR-012**: A importação DEVE aplicar as mesmas regras de validação do salvamento de um workflow, citando, para cada erro, o nó e o motivo.
- **FR-013**: QUANDO faltarem a um nó o identificador, a posição, a versão do tipo ou parte dos parâmetros, a importação DEVE gerar o identificador, posicionar o nó automaticamente, usar a versão instalada do tipo e preencher os parâmetros omitidos com o valor padrão do nó.
- **FR-014**: A importação NÃO DEVE criar credenciais. Cada credencial citada DEVE ser procurada no projeto de destino:
  1. pelo identificador, se a credencial for do mesmo tipo;
  2. senão, pelo nome e tipo, se houver uma única correspondência;
  3. senão, o nó fica sem credencial e a pendência aparece na prévia.
- **FR-015**: As referências a outros recursos que não existam, não estejam acessíveis ou estejam em conflito no destino DEVEM ser listadas como pendências, sem impedir a criação do rascunho. São elas: workflow chamado, workflow de erro, servidor MCP, modelo de IA e caminho de webhook.
- **FR-016**: Arquivos com tipos de nó do N8N DEVEM ser recusados com a orientação de usar o importador do N8N (spec 012).
- **FR-017**: Importar DEVE exigir permissão para criar workflows no projeto e DEVE ser auditado. O registro traz o workflow criado, a contagem de nós e as pendências, sem o conteúdo.
- **FR-018**: A importação NÃO DEVE executar nada do arquivo (expressões, código ou chamadas externas) e DEVE tratá-lo como conteúdo não confiável, recusando arquivos acima dos limites ou com estruturas que alterem objetos internos.
- **FR-019**: Copiar nós no canvas DEVE colocar na área de transferência o JSON no formato do arquivo, com os nós selecionados e as conexões entre eles, sem segredos.
- **FR-020**: Colar no canvas um JSON no formato do arquivo, completo ou só com os nós e as conexões, DEVE acrescentar os nós ao workflow:
  - com as mesmas regras de validação, credenciais e referências da importação;
  - com sufixo numérico nos nomes repetidos;
  - com as conexões atualizadas para os novos nomes.

  Um texto inválido NÃO DEVE alterar o canvas.
- **FR-021**: DEVE existir uma documentação do formato em `docs/nos/` que descreva:
  - a estrutura completa do arquivo, com conexões, portas, sub-nós, laços, saída de erro, credenciais, dados fixados e configurações;
  - todos os tipos de nó, com portas, credenciais aceitas e parâmetros (tipo, valores possíveis e padrão);
  - as expressões, as regras de validação, uma lista de verificação para quem gera o JSON e exemplos completos.
- **FR-022**: Uma verificação automatizada DEVE falhar se algum tipo de nó da plataforma não estiver na documentação, ou se algum exemplo completo da documentação não puder ser importado sem erros.

## Requisitos não funcionais

- **NFR-001**: Ida e volta sem perda: exportar e importar um workflow produz uma definição equivalente (mesmos nós, parâmetros, conexões, configurações e, quando incluídos, dados fixados). As exceções são os identificadores gerados e as credenciais não encontradas.
- **NFR-002**: A importação tem limites configuráveis de tamanho do arquivo, quantidade de nós e profundidade, com padrões definidos no plano. Um arquivo acima do limite é recusado com uma mensagem que cita o limite.
- **NFR-003**: Nenhum segredo sai na exportação nem aparece nos logs ou na auditoria da exportação e da importação.
- **NFR-004**: A prévia de um workflow com 200 nós fica pronta em menos de 2 segundos.

## Entidades-chave

- **Arquivo de workflow**: JSON com a estrutura do N8N e os tipos e parâmetros do Olly Flow, com a versão do formato. É o mesmo conteúdo usado ao copiar e colar nós.
- **Prévia da importação**: resultado da validação de um arquivo antes de criar o workflow (contagens, erros, pendências e avisos).
- **Pendência de importação**: algo a resolver depois de importar, que não impede o rascunho: credencial não encontrada, referência inexistente ou conflito de caminho de webhook.

## Critérios de sucesso

- **SC-001**: Um workflow com todos os tipos de nó, baixado e importado em outro projeto, é equivalente ao original (NFR-001).
- **SC-002**: Nenhum segredo de credencial ou valor sensível aparece no arquivo baixado, na área de transferência, nos logs ou na auditoria (busca por valores sentinela).
- **SC-003**: Todos os exemplos completos da documentação são importados sem erros, e todo tipo de nó da plataforma está documentado.
- **SC-004**: Um modelo de IA, recebendo só a documentação e um pedido em linguagem natural, gera um JSON importável sem erros em pelo menos 8 de 10 pedidos de referência. Os pedidos cobrem webhook, If, Merge, laço e Agent com ferramentas.
- **SC-005**: Um arquivo inválido ou hostil é recusado com a lista de erros, sem criar nada e sem afetar a plataforma.
- **SC-006**: Nós copiados de um workflow e colados em outro, inclusive depois de passar por um editor de texto, mantêm os parâmetros e as conexões.

## Fora do escopo

- Conversão de arquivos exportados do N8N (tipos e parâmetros do N8N): importador da spec 012.
- Importar a partir de uma URL, como o "Import from URL" do N8N.
- Exportar ou importar vários workflows de uma vez, projetos inteiros, credenciais ou variáveis.
- Baixar uma versão específica do histórico.
- Sincronização com Git e promoção entre ambientes (backlog pós go-live).
- Gerar workflows por IA dentro da plataforma: esta spec entrega o formato e a documentação que tornam isso possível fora dela.

## Pré-requisitos humanos

- Respostas aos pontos em aberto.
- Lista dos 10 pedidos de referência do SC-004 e acesso a um modelo de IA aprovado (ADR-0008) para a validação.

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: **Tipos dos nós no arquivo.** Manter os tipos atuais do Olly Flow (`http.request`, `logic.if`), ou adotar um prefixo de pacote no estilo do N8N (`olly-flow.httpRequest`)? Proposta: manter os atuais. São os mesmos da plataforma e da documentação, e não sugerem uma compatibilidade de parâmetros com o N8N que não existe.]
- [PRECISA ESCLARECIMENTO: **Dados fixados na exportação.** O N8N sempre os inclui. Proposta, por causa da LGPD: não incluir por padrão e oferecer a opção "Incluir dados fixados", com um aviso de que podem conter dados pessoais.]
- [PRECISA ESCLARECIMENTO: **Importador do N8N.** Esta spec recusa arquivos do N8N e orienta usar o importador da spec 012 (proposta). Ou deve absorver a HU-2 da spec 012, com uma única tela de importação para os dois formatos?]
- [PRECISA ESCLARECIMENTO: **Tipo de nó desconhecido.** Recusar a importação listando os tipos (proposta), ou importar como nó marcador desabilitado com o conteúdo original preservado (previsto na spec 012, ainda não implementado), bloqueando só a publicação?]
- [PRECISA ESCLARECIMENTO: **Quem pode baixar.** Qualquer papel que pode ver o workflow, inclusive Visualizador, já que o arquivo não tem segredos (proposta)? Ou só Editor e Admin do projeto?]

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 07/10/2026 | Criação | Pedido do PO: baixar e importar workflows em JSON nos moldes do N8N, com documentação do formato para modelos de IA |
