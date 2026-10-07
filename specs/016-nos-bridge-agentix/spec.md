# Spec 016 — Nós Bridge Chat Model e Agentix

| Campo | Valor |
|---|---|
| **Status** | Planejada |
| **Fase** | 4 — Hardening (integrações institucionais, antes do go-live) |
| **Depende de** | 004, 011, 015 |
| **Requisitos de produto** | PR-16 (parcial), PR-17 (parcial), PR-18 (parcial) |
| **ADRs relacionadas** | 0001, 0008 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Na POC, a instituição criou dois nós customizados para o N8N (projeto `Bridge-Chat-Model`, pacote `n8n-nodes-bridge-chat-model`). Eles dão acesso a dois serviços internos de IA, e os workflows da POC dependem deles. Para migrar esses workflows (ADR-0001), o Olly Flow precisa oferecer nós equivalentes.

1. **Bridge Chat Model:** modelo de chat para o Agent, servido pela **Bridge**, o gateway interno de IA. A API se parece com o `chat/completions` da OpenAI, com três diferenças:
   - o **modelo vai no endereço**, e não no corpo: `<URL base>/deployments/{modelo}/chat/completions`;
   - a autenticação é por um **token de curta duração (~20 minutos)**, obtido num endpoint de login com identificador e senha de um usuário de serviço. A resposta do login traz o token no campo `token`;
   - o campo `model` não consta no corpo documentado da Bridge.
2. **Agentix:** nó que **invoca um agente ou workflow do Agentix**, a plataforma interna de agentes, e devolve a resposta ao fluxo. Autentica-se por uma chave de API no cabeçalho `X-API-Key`. A chamada é assíncrona:
   1. `POST sessions/invoke` cria uma sessão e devolve `session_id`;
   2. `GET sessions/{session_id}` é consultado até o campo `state` indicar o fim:
      - `DONE` termina com sucesso;
      - `FAILED`, `CANCELLED` e `REJECTED` são falha;
      - `QUEUED`, `RUNNING` e `BLOCKED` seguem em andamento;
   3. `GET sessions/{session_id}/messages` devolve as mensagens; a resposta final é o conteúdo da última mensagem do papel `assistant`.

Os dois nós do N8N foram validados só contra simulações dos serviços. O comportamento esperado, descrito abaixo, segue o código e a documentação desse projeto.

## Histórias de usuário

### HU-1 — Usar a Bridge como modelo de chat do Agent (Prioridade: P1)

Como **editor**, quero ligar um modelo servido pela Bridge ao Agent, informando o modelo pelo nome, para usar os modelos do gateway interno da instituição.

**Teste independente:** num Agent com o modelo da Bridge (contra um serviço simulado), executar uma conversa com uma chamada de ferramenta e conferir o endereço com o modelo, o token, a resposta, o uso de tokens e os passos do agente.

**Cenários de aceite:**
1. **Dado** uma credencial Bridge válida e o nome do modelo informado no nó, **quando** o Agent executa, **então** a chamada vai para `<URL base>/deployments/{modelo}/chat/completions` com o token do login e a resposta segue para o Agent, inclusive com chamadas de ferramenta.
2. **Dado** uma execução longa, **quando** o token expira no meio dela, **então** ele é renovado antes de vencer, sem interromper a execução.
3. **Dado** uma resposta de token recusado (401 ou 403), **quando** ela acontece, **então** um novo login é feito e a chamada é repetida uma vez.
4. **Dado** várias chamadas simultâneas com a mesma credencial, **quando** o token precisa ser obtido, **então** um único login é feito para todas.
5. **Dado** uma Bridge com certificado de uma CA interna, **quando** a credencial tem a opção de não verificar o certificado ligada, **então** a chamada é feita; com a opção desligada (padrão), o certificado é verificado.
6. **Dado** o cadastro da credencial, **quando** clico em **Testar**, **então** a plataforma faz o mesmo login usado na execução e mostra o resultado.

### HU-2 — Invocar um agente ou workflow do Agentix (Prioridade: P1)

Como **editor**, quero um nó que invoca um agente ou workflow do Agentix e devolve a resposta, para usar no fluxo os agentes já construídos na plataforma da instituição.

**Teste independente:** contra um Agentix simulado, executar o nó com espera e conferir:
- a sequência invocar → consultar até `DONE` → mensagens;
- a saída "resposta final" e "todas as mensagens";
- as falhas por estado, por tempo limite e por chave inválida.

**Cenários de aceite:**
1. **Dado** o tipo (agente ou workflow), o nome, a versão, o bundle, a versão do bundle, o payload e as constantes, **quando** o nó executa, **então** a sessão é criada com esses valores e o nó espera o fim, consultando a sessão no intervalo configurado.
2. **Dado** uma sessão que termina em `DONE`, **quando** escolho a saída "resposta final", **então** o item de saída traz `session_id`, `state` e `output` com o conteúdo da última mensagem `assistant`. **Quando** escolho "todas as mensagens", **então** ele traz `session_id`, `state` e `messages`.
3. **Dado** uma sessão que termina em `FAILED`, `CANCELLED` ou `REJECTED`, **quando** o nó a consulta, **então** ele falha com o estado e a mensagem de erro informada pelo Agentix.
4. **Dado** uma sessão que não termina no tempo limite configurado no nó (padrão 600 s), **quando** ele passa, **então** o nó falha citando o último estado e como aumentar o tempo.
5. **Dado** "esperar o fim" desligado, **quando** o nó executa, **então** ele devolve a resposta da criação da sessão (com `session_id`) sem esperar.
6. **Dado** vários itens de entrada, **quando** o nó executa, **então** cada item invoca uma sessão. Com o tratamento de erro "continuar", o item que falha vira um item de erro e os demais seguem.
7. **Dado** uma execução cancelada pelo usuário, **quando** o nó está esperando a sessão, **então** a espera é interrompida.

### HU-3 — Migrar os workflows da POC que usam esses nós (Prioridade: P1)

Como **editor**, quero importar workflows do N8N que usam os nós customizados, para que eles cheguem convertidos em vez de virarem nós marcadores.

**Teste independente:** importar, no formato N8N, um workflow com os dois nós customizados e conferir os tipos, os parâmetros e as credenciais a cadastrar.

**Cenários de aceite:**
1. **Dado** um workflow do N8N com o Bridge Chat Model ligado a um AI Agent e um nó Agentix, **quando** importo, **então** os dois nós são convertidos com os mesmos parâmetros e as conexões, e as credenciais Bridge e Agentix aparecem na lista de credenciais a cadastrar.
3. **Dado** um Agentix ligado como ferramenta de um AI Agent no N8N, **quando** importo, **então** ele vira um nó marcador (o uso como ferramenta está fora do escopo).
2. **Dado** os tipos dos nós customizados com o prefixo da instalação (por exemplo, `CUSTOM.agentix`) ou o do pacote, **quando** importo, **então** os dois são reconhecidos.

### Casos de borda

- **Login da Bridge recusado ou sem `token` na resposta:** a execução falha com o status e um trecho da resposta, sem expor a senha.
- **Token sem validade legível:** vale a duração padrão de 20 minutos, menos a margem de segurança.
- **Resposta em streaming:** com o streaming ligado (padrão), a resposta chega em partes; o uso de tokens só é pedido se a opção correspondente estiver ligada, porque a Bridge não documenta esse parâmetro.
- **Mensagens do Agentix:** sessão `DONE` sem nenhuma mensagem `assistant` gera erro no modo "resposta final". As mensagens `assistant` intermediárias (com chamadas de ferramenta) não contam como resposta final quando há uma posterior.
- **Respostas embrulhadas:** a lista de mensagens pode vir pura ou dentro de `messages` ou `items`; as três formas são aceitas.
- **Falha transitória na consulta da sessão:** tolerada até um número configurável de erros seguidos; depois, o nó falha.
- **Payload ou constantes que não são um objeto JSON:** erro no item, com o nome do parâmetro.
- **Agentix sem `session_id` na resposta da criação:** erro no item, com a resposta recebida.
- **Serviço em endereço interno:** a proteção anti-SSRF bloqueia endereços internos não liberados; a mensagem orienta a liberação pela instalação. Desligar a verificação do certificado não desliga a proteção anti-SSRF.
- **Modelo inexistente na Bridge:** o nome do modelo não é validado pela plataforma; o erro da Bridge (por exemplo, 404) volta na execução, com o status e um trecho da resposta.

## Requisitos funcionais

- **FR-001**: DEVE existir o nó **Bridge Chat Model**, um sub-nó de modelo de chat ligável à entrada de modelo do Agent, com os parâmetros:
  - **modelo** (obrigatório): texto livre com o apelido enviado no endereço, sem lista de modelos;
  - **streaming** (padrão ligado);
  - **opções:** temperatura, top P, máximo de tokens, número de respostas, sequências de parada, usuário final, tempo limite, novas tentativas, pedir o uso de tokens no streaming (padrão desligado) e enviar o modelo também no corpo (padrão desligado).
- **FR-002**: DEVE existir o tipo de credencial **Bridge**, com:
  - endereço de login, URL base, identificador e senha (secreta), todos obrigatórios e **sem valor padrão**;
  - margem de segurança da renovação do token (padrão 60 segundos);
  - **não verificar o certificado TLS** (padrão desligado).

  Testar a credencial DEVE fazer o mesmo login da execução.
- **FR-003**: Cada chamada à Bridge DEVE ir para `<URL base>/deployments/{modelo}/chat/completions`, com o token no cabeçalho `Authorization: Bearer`. O campo `model` NÃO DEVE ir no corpo, a menos que a opção correspondente esteja ligada.
- **FR-004**: O token DEVE ser obtido no endpoint de login (identificador e senha) e reaproveitado entre chamadas da mesma credencial. Ele DEVE ser renovado antes do vencimento indicado no próprio token, menos a margem de segurança, com 20 minutos de duração padrão quando o vencimento não for legível. Logins simultâneos da mesma credencial DEVEM ser unificados num só.
- **FR-005**: QUANDO a Bridge recusar o token (401 ou 403), o sistema DEVE descartá-lo, fazer um novo login e repetir a chamada uma única vez.
- **FR-006**: O Bridge Chat Model NÃO DEVE consultar a lista de modelos liberados (Administração › IA). Ele DEVE seguir o restante da governança de IA da spec 011:
  - limite mensal de tokens do projeto;
  - registro do uso (com o nome do modelo informado) e do custo, quando houver preço cadastrado para ele;
  - passos do agente e aprovação de ferramentas.
- **FR-007**: DEVE existir o nó **Agentix**, com entrada e saída principais, e os parâmetros:
  - tipo da entidade (agente ou workflow), nome, versão, bundle e versão do bundle (obrigatórios);
  - payload e constantes (objetos JSON, com expressão);
  - esperar o fim (padrão ligado);
  - saída ("resposta final" ou "todas as mensagens");
  - opções: intervalo da consulta (padrão 3 s), **tempo limite configurável no nó** (padrão 600 s; 0 = sem limite próprio, valendo os limites do nó e do workflow), erros de consulta seguidos tolerados (padrão 3) e incluir os detalhes da sessão.
- **FR-008**: DEVE existir o tipo de credencial **Agentix**, com:
  - URL base e chave de API (secreta), obrigatórias e **sem valor padrão**;
  - **não verificar o certificado TLS** (padrão desligado).

  A chave DEVE ir no cabeçalho `X-API-Key` de todas as chamadas.
- **FR-009**: O nó Agentix DEVE, para cada item:
  1. criar a sessão com os parâmetros (`entity_type`, `entity_name`, `entity_version`, `bundle`, `version`, `payload`, `constants`);
  2. com a espera ligada, consultar a sessão dentro do próprio nó até um estado final e buscar as mensagens;
  3. montar a saída escolhida, incluindo a sessão final (com o uso de tokens) quando a opção estiver ligada.
- **FR-010**: Os estados `FAILED`, `CANCELLED` e `REJECTED`, o tempo limite e o excesso de erros de consulta DEVEM fazer o item falhar com uma mensagem que cita a sessão e o motivo. O tratamento de erro do nó ("parar", "continuar" ou "saída de erro") DEVE valer por item.
- **FR-011**: A espera pela sessão DEVE ser interrompida quando a execução for cancelada ou atingir o tempo limite do nó ou do workflow.
- **FR-012**: A importação do N8N (spec 015) DEVE converter o Bridge Chat Model, o Agentix e as credenciais `bridgeApi` e `agentixApi` para os nós e tipos de credencial desta spec. Os tipos com o prefixo `CUSTOM.` e com o do pacote DEVEM ser reconhecidos como tipos do N8N. O Agentix usado como ferramenta de um AI Agent DEVE virar nó marcador.
- **FR-013**: Os nós DEVEM respeitar a proteção anti-SSRF da plataforma (endereços internos só com liberação da instalação), inclusive com a verificação do certificado desligada.
- **FR-014**: Senha, chave de API e token NÃO DEVEM aparecer em logs, respostas da API, dados de execução, auditoria ou telemetria.
- **FR-015**: A documentação DEVE incluir uma página para cada nó novo em `docs/nos/`, e os dois tipos DEVEM entrar na documentação do formato JSON (spec 015, FR-021).

## Requisitos não funcionais

- **NFR-001**: Um único login por credencial a cada ciclo do token, mesmo com dezenas de chamadas simultâneas (verificado com um serviço simulado).
- **NFR-002**: A espera do Agentix não deve consumir CPU entre as consultas, e uma sessão em andamento não deve impedir o encerramento ordenado do worker além do tempo de encerramento configurado.
- **NFR-003**: Toda a verificação automatizada usa serviços simulados da Bridge e do Agentix: os testes não dependem dos serviços reais.

## Entidades-chave

- **Credencial Bridge:** endereço de login, URL base, identificador, senha e margem de renovação.
- **Token da Bridge:** credencial de acesso de curta duração, obtida pelo login, reaproveitada e renovada pela plataforma; nunca guardada em dados de execução.
- **Credencial Agentix:** URL base e chave de API.
- **Sessão do Agentix:** execução assíncrona de um agente ou workflow, com identificador, estado, mensagens e uso de tokens.

## Critérios de sucesso

- **SC-001**: Com a Bridge simulada, um Agent com o Bridge Chat Model conclui uma conversa com chamada de ferramenta. Verificam-se o endereço com o modelo, o token, a ausência de `model` no corpo, o streaming e o uso de tokens registrado, também com um servidor de certificado autoassinado e a verificação desligada.
- **SC-002**: Com a Bridge simulada, uma execução que atravessa a expiração do token e uma resposta 401 termina com sucesso, com um login por ciclo.
- **SC-003**: Com o Agentix simulado, o nó cobre: as duas saídas, a espera desligada, os três estados de falha, o tempo limite, a falha transitória tolerada e a não tolerada, a chave inválida e o "continuar" por item.
- **SC-004**: Nenhuma senha, chave ou token aparece em logs, respostas, dados de execução, auditoria ou telemetria (busca por valores sentinela).
- **SC-005**: Um workflow do N8N com os dois nós customizados é importado sem nós marcadores.
- **SC-006**: Validação manual em homologação com a Bridge e o Agentix reais, depois da liberação de acesso.

## Fora do escopo

- Outras APIs da Bridge além do `chat/completions` (por exemplo, embeddings) e outras operações do Agentix além de invocar e acompanhar uma sessão (cancelar, listar, gerenciar agentes).
- Imagens e binários nas mensagens da Bridge.
- **Agentix como ferramenta do Agent** (decisão do PO em 07/10/2026).
- Lista de modelos para a Bridge e validação do nome do modelo pela plataforma.
- Pausar a execução enquanto a sessão do Agentix roda: a espera ocupa o worker (decisão do PO).
- Publicar os nós como pacote reutilizável fora do Olly Flow.

## Pré-requisitos humanos

- **ADR-0008:** decisão institucional sobre a **Bridge como provedor de LLM aprovado** (a ADR hoje cita OpenAI, Claude e Google).
- **Acesso de homologação** à Bridge e ao Agentix, com o usuário de serviço da Bridge e uma chave do Agentix, para o SC-006.
- **Rede:** liberação dos endereços internos da Bridge e do Agentix na allowlist da instalação.
- **Workflows da POC** que usam os dois nós, exportados em `fixtures/n8n/`, para o SC-005.

## Pontos em aberto

- Nenhum. (Respondidos pelo PO em 07/10/2026; ver o histórico.)

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 07/10/2026 | Criação, a partir da análise do projeto `Bridge-Chat-Model` (nós customizados do N8N) | Pedido do PO |
| 07/10/2026 | Esclarecimentos do PO: (1) cada credencial permite desligar a verificação do certificado TLS (FR-002, FR-008; risco aceito); (2) sem endereços padrão: o usuário informa todos (FR-002, FR-008); (3) a espera do Agentix fica dentro do nó, ocupando o worker, com o tempo limite padrão de 600 s configurável no nó (FR-007, FR-009); (4) o Agentix não entra como ferramenta do Agent: HU-3 removida e a antiga HU-4 virou HU-3; FR-012 anterior removido e FRs renumerados; (5) a Bridge não usa lista de modelos: o modelo é texto livre (FR-001, FR-006) | Decisão humana |
