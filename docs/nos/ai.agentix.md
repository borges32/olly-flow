# Agentix (`ai.agentix`)

Invoca um **agente ou workflow do Agentix**, a plataforma interna de agentes, e devolve a resposta ao fluxo. Equivale ao nó customizado "Agentix" (`agentix`, pacote `n8n-nodes-bridge-chat-model`) da POC no N8N.

| Item | Valor |
|---|---|
| Categoria | IA |
| Entrada / saída | `main` → `main` (e `error` com "saída de erro") |
| Credencial | `agentixApi` |
| Itens | Uma sessão por item, em sequência |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `entityType` | `agent` ou `workflow` (`entity_type`; padrão `agent`) |
| `entityName` | Nome da entidade (`entity_name`). Obrigatório |
| `entityVersion` | Versão da entidade (`entity_version`). Obrigatório |
| `bundle` | Bundle que contém a entidade. Obrigatório |
| `bundleVersion` | Versão do bundle (enviada como `version`). Obrigatório |
| `payload` | Entrada do agente: objeto JSON (texto ou expressão). Padrão `{"pergunta": ""}` |
| `constants` | Constantes do agente: objeto JSON. Padrão `{}` |
| `waitForCompletion` | Espera o fim da sessão (padrão ligado). Desligado: devolve na hora a resposta da criação, com o `session_id` |
| `output` | Com espera: `finalAnswer` (só a resposta final) ou `allMessages` (todas as mensagens) |
| `options.pollIntervalSeconds` | Intervalo entre as consultas ao estado (padrão 3 s; mínimo 0,1) |
| `options.timeoutSeconds` | Tempo limite da espera, configurável no nó (padrão 600 s; 0: sem limite próprio, valendo os limites do nó e do workflow) |
| `options.maxPollErrors` | Erros de consulta seguidos tolerados (padrão 3) |
| `options.includeSession` | Acrescenta a sessão final (uso de tokens, datas) na saída |

## Credencial `agentixApi` ("Agentix")

| Campo | Descrição |
|---|---|
| `baseUrl` | Raiz da API do Agentix, com o caminho da API (ex.: `https://<host>/v2/api`). Obrigatória, **sem valor padrão**. Se for colada com o endpoint (`…/sessions/invoke`), o nó usa a raiz |
| `apiKey` | Chave da API (secreta), enviada no cabeçalho `X-API-Key` |
| `allowUnauthorizedCerts` | Não verificar o certificado TLS (padrão desligado) |

**Testar** não está disponível: como no N8N, o Agentix não tem um endpoint só de validação, e a credencial é validada na primeira execução.

## Comportamento

1. **Criação (FR-009):** `POST <baseUrl>/sessions/invoke` com `entity_type`, `entity_name`, `entity_version`, `bundle`, `version`, `payload` e `constants`. A resposta traz `session_id` e `status` (além de `component`, `tenant_id`, `bundle_version`...). Sem `session_id`, o item falha; com `status` `REJECTED`, `FAILED` ou `CANCELLED`, o item falha sem consultar a sessão.
2. **Espera (FR-009, FR-011):** `GET sessions/{id}` a cada intervalo, **dentro do nó** (o worker fica ocupado durante a sessão, sem consumir CPU entre as consultas). Estados:
   - `DONE`: fim com sucesso;
   - `FAILED`, `CANCELLED`, `REJECTED`: o item falha com o estado e o `error_message` do Agentix;
   - `QUEUED`, `RUNNING`, `BLOCKED`: em andamento.

   A espera é interrompida quando a execução é cancelada ou atinge o tempo limite do nó ou do workflow.
3. **Mensagens:** `GET sessions/{id}/messages`, aceitando a lista pura ou embrulhada em `messages` ou `items`.
4. **Saída:**
   - `finalAnswer`: `{ session_id, state, output }`, com o conteúdo da **última** mensagem `assistant` (as intermediárias, com chamadas de ferramenta, não contam). Sem nenhuma mensagem `assistant`, o item falha;
   - `allMessages`: `{ session_id, state, messages }`;
   - com `includeSession`, acrescenta `session`.

- **Erros (FR-010):**
  - tempo limite: cita o último estado e como aumentar o tempo;
  - falha transitória na consulta: tolerada até `maxPollErrors` erros seguidos;
  - resposta fora de 2xx: `Chamada ao Agentix falhou: <método> <endereço> respondeu <status> (<motivo>)`, com o `detail` do Agentix e o endereço chamado (sem a chave). Em 401 e 403, a mensagem pede para conferir a chave e a URL base;
  - payload ou constantes que não sejam um objeto JSON: erro no item, citando o parâmetro.
- **Tratamento de erro por item:** "continuar" emite `{ error }` no lugar do item que falhou e segue com os demais; "saída de erro" desvia o item para a porta `error`.
- **Rede (FR-013):** as chamadas passam pelo filtro anti-SSRF, mas **aceitam endereços de rede privada sem a allowlist**. Loopback, link-local (inclusive o endereço de metadados da nuvem) e protocolos diferentes de HTTP e HTTPS continuam barrados.
- **TLS (FR-008):** `allowUnauthorizedCerts` vale só para as chamadas desta credencial.
- **Segredos (FR-014):** a chave nunca aparece em logs, dados de execução ou respostas da API.
- **Cabeçalhos:** `X-API-Key`, `Accept: application/json` e `User-Agent: Olly-Flow/1.0 (agentix)` (o `fetch` enviaria `undici`, que WAFs e gateways corporativos costumam barrar com 403).

## Erro 403

O Agentix (ou um gateway na frente dele) recusou a chamada. A mensagem mostra o endereço chamado e o motivo devolvido:
- **`Not authenticated` ou `Invalid API Key`:** confira a chave da credencial (sem espaços) e se ela vale para o ambiente chamado.
- **Endereço errado:** a URL base precisa terminar no caminho da API (ex.: `…/v2/api`); um caminho não mapeado costuma voltar 403 ou 404 do gateway.
- **Sem motivo no corpo (página HTML do proxy ou do WAF):** a rede barrou a chamada; confira, com a infraestrutura, a liberação da origem (API e workers) para o endereço do Agentix.

## Exemplo (trecho do JSON do workflow)

```json
{
  "name": "Agentix",
  "type": "ai.agentix",
  "typeVersion": 1,
  "position": [500, 0],
  "parameters": {
    "entityType": "agent",
    "entityName": "conversor-markdown-html-agent",
    "entityVersion": "0.1.0",
    "bundle": "olly-gerador-kb",
    "bundleVersion": "0.1.0.dev10",
    "payload": "={{ { pergunta: $json.pergunta } }}",
    "constants": "{}",
    "waitForCompletion": true,
    "output": "finalAnswer",
    "options": { "pollIntervalSeconds": 3, "timeoutSeconds": 600 }
  },
  "credentials": { "agentixApi": { "id": "<id>", "name": "Agentix" } }
}
```

## Divergências do N8N

- **Agentix como ferramenta do Agent:** fora do escopo (decisão do PO); na importação, esse uso vira [nó marcador](placeholder.unsupported.md).
- **Opções:** `pollInterval` e `timeout` viram `pollIntervalSeconds` e `timeoutSeconds`.
- **Saída de erro:** o tratamento "saída de erro" (porta `error`) também vale.

Introduzido na [spec 016](../../specs/016-nos-bridge-agentix/spec.md) (FR-007 a FR-011, FR-013, FR-014).
