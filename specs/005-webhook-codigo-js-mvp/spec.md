# Spec 005 — Webhook, código JavaScript e fechamento do MVP

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 1 — MVP |
| **Depende de** | 004 |
| **Requisitos de produto** | PR-06, PR-07, PR-08, PR-09, PR-17 (parcial), PR-19 (parcial) |
| **ADRs relacionadas** | 0001, 0003 |

## Contexto e problema

Para o MVP, os workflows precisam:
- ser publicados e acionados por sistemas externos;
- aceitar lógica customizada em JavaScript;
- ter suas execuções consultáveis.

O MVP é validado recriando workflows reais da POC. Ao final, a gestão decide o Go/No-Go.

## Histórias de usuário

### HU-1 — Publicar e acionar por webhook (P1)

Como **sistema externo**, quero acionar um workflow publicado por uma URL autenticada e receber a resposta configurada.

**Cenários de aceite:**
1. **Dado** um workflow publicado com webhook HMAC, **quando** envio uma requisição com assinatura válida, **então** o workflow executa. Com assinatura inválida, recebo 401.
2. **Dado** o modo de resposta "ao final", **quando** o workflow termina, **então** recebo a saída do último nó.
3. **Dado** um nó "Responder ao webhook", **quando** ele executa, **então** recebo o status, os headers e o corpo configurados.
4. **Dado** um rascunho alterado após a publicação, **quando** o webhook é acionado, **então** executa a versão publicada.

### HU-2 — Testar webhook no editor (P1)

Como **editor**, quero escutar uma chamada de teste e ver o payload chegar no editor.

### HU-3 — Código JavaScript (P1)

Como **editor**, quero escrever JavaScript com a mesma API do N8N para transformar itens.

**Cenários de aceite:**
1. **Dado** o código `return $input.all().map(i => ({ json: { ...i.json, total: i.json.q * i.json.p } }))`, **quando** executo, **então** cada item ganha o campo `total`.
2. **Dado** um código com laço infinito, alocação excessiva ou `require`, **quando** executo, **então** o nó falha com mensagem clara e o servidor continua estável.

### HU-4 — Consultar execuções (P1)

Como **executor ou auditor**, quero listar e filtrar execuções e abrir uma delas no canvas com os dados de cada nó.

### HU-5 — Garantia de permissões e auditoria (P1)

Como **administrador**, quero evidência automatizada de que cada papel só faz o que deve, e que as ações ficam auditadas.

### Casos de borda

- Resposta síncrona demora além do limite: o webhook retorna 504 com o id da execução, e a execução continua.
- O nó "Responder ao webhook" executa duas vezes: vale a primeira resposta.
- O processo do sandbox morre por falta de memória: o nó falha e o sandbox é reiniciado.

## Requisitos funcionais

- **FR-001**: O sistema DEVE permitir publicar uma versão específica de um workflow e despublicá-lo. Execuções de produção DEVEM usar sempre a versão publicada.
- **FR-002**: A publicação DEVE exigir validação estrutural sem erros e, quando configurado, autenticação em webhooks de produção.
- **FR-003**: As execuções DEVEM ser despachadas por uma abstração substituível, com limite de execuções concorrentes. Nesta spec, a execução ocorre no processo da API.
- **FR-004**: O nó `trigger.webhook` DEVE aceitar caminho (com parâmetros), método HTTP e autenticação (nenhuma, header, Basic ou HMAC). A saída DEVE conter headers (sem os sensíveis), params, query e body.
- **FR-005**: O webhook DEVE suportar os modos de resposta: imediata (202 + id), saída do último nó, e nó de resposta.
- **FR-006**: O webhook DEVE aplicar limite de tamanho do payload, rate limit por rota e, opcionalmente, CORS e allowlist de IP.
- **FR-007**: DEVE existir uma URL de teste que, enquanto o editor escuta, entrega o payload ao editor em tempo real.
- **FR-008**: O nó `http.respondToWebhook` DEVE configurar status, headers e corpo (primeiro item, todos os itens, texto, vazio, binário). Apenas a primeira resposta vale.
- **FR-009**: O nó `code.javascript` DEVE executar código de usuário isolado, nos modos "uma vez para todos os itens" e "uma vez por item", com a API do N8N, `console.log` capturado e suporte a `async/await`.
- **FR-010**: O código JS NÃO DEVE ter acesso a módulos, processo, rede ou sistema de arquivos, e DEVE respeitar limites de memória e tempo.
- **FR-011**: O retorno do código DEVE ser normalizado para itens (objeto, array de objetos ou array de `{ json }`). Outros tipos geram erro descritivo.
- **FR-012**: O editor de código DEVE oferecer autocomplete das variáveis e dos nomes dos nós, e exibir a saída do console.
- **FR-013**: O sistema DEVE listar execuções com filtros (projeto, workflow, status, modo, gatilho, usuário, período) e abrir uma execução no canvas em modo somente leitura.
- **FR-014**: Os dados de execução DEVEM ser omitidos para quem não tem `execution:readData`.
- **FR-015**: O sistema DEVE permitir copiar os dados de uma execução como pin data no rascunho.
- **FR-016**: O sistema DEVE auditar: criar, editar, excluir, publicar e despublicar workflow; ações de credenciais; alterações de membros e papéis; execução manual.
- **FR-017**: DEVE existir um teste automatizado da matriz papel × ação que gera a documentação da matriz RBAC.
- **FR-018**: Os workflows de referência da POC DEVEM ser recriados no formato Olly Flow e verificados contra a saída esperada.

## Requisitos não funcionais

- **NFR-001**: Payload máximo padrão de 16 MB; timeout de resposta síncrona padrão de 120 s.
- **NFR-002**: Código JS com 128 MB e 30 s por padrão.
- **NFR-003**: Comparação HMAC em tempo constante.

## Entidades-chave

- **Publicação**: versão ativa de um workflow.
- **Rota de webhook**: caminho + método → workflow/nó.

## Critérios de sucesso

- **SC-001**: ≥ 2 workflows da POC recriados com resultado equivalente.
- **SC-002**: HMAC válido dispara a execução; inválido retorna 401.
- **SC-003**: Os três modos de resposta funcionam.
- **SC-004**: Matriz RBAC 100% verde e `docs/rbac-matriz.md` gerado.
- **SC-005**: 100% das execuções registradas com status e duração por nó.
- **SC-006**: Código JS malicioso é contido sem afetar a API.
- **SC-007**: A produção usa a versão publicada mesmo com o rascunho alterado.

## Fora do escopo

Fila/workers, paralelismo, Merge, While, Python, cron, OAuth2 Authorization Code e `fetch` no código JS.

## Pré-requisitos humanos

- Fixtures da POC em `fixtures/n8n/` (sem elas, SC-001 fica pendente).
- **Após esta spec:** reunião de Go/No-Go registrada em ADR. A spec 006 não começa sem ela.

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: o webhook de produção sem autenticação deve ser bloqueado (`OLLY_REQUIRE_WEBHOOK_AUTH=true`) já no MVP?] O padrão é apenas aviso.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 4 | Migração para SDD |
| 03/10/2026 | Permissões RBAC explicitadas no plano (seção e tarefa T089), sem mudança de requisito | Decisão humana sobre permissões por spec |
