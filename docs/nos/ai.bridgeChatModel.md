# Bridge Chat Model (`ai.bridgeChatModel`)

Sub-nó do [Agente de IA](ai.agent.md): um **modelo de chat customizado** servido pela **Bridge**, o gateway interno de IA da instituição (ADR-0008, complemento de 07/10/2026). Equivale ao nó customizado "Bridge Chat Model" (`bridgeChatModel`, pacote `n8n-nodes-bridge-chat-model`) da POC no N8N.

| Item | Valor |
|---|---|
| Categoria | IA (sub-nó) |
| Saída | `ai_languageModel` (na base do Agent) |
| Credencial | `bridgeApi` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `model` | Obrigatório. Apelido do modelo na Bridge, enviado no endereço (`deployments/{modelo}/chat/completions`), ex.: `gemini-2.5-flash`. Texto livre: não há lista de modelos, e quem confere o nome é a Bridge |
| `stream` | Streaming da resposta (padrão ligado). Evita o tempo limite de proxies em respostas longas |
| `options.temperature` | Opcional, 0 a 2. Vazio: o padrão do modelo |
| `options.topP` | Opcional, 0 a 1 |
| `options.maxTokens` | Máximo de tokens da resposta (0: o modelo decide) |
| `options.n` | Número de respostas por pedido (padrão 1) |
| `options.stop` | Sequências de parada, separadas por vírgula |
| `options.user` | Identificador do usuário final repassado à Bridge |
| `options.timeoutMs` | Tempo máximo de cada chamada (padrão 360.000 ms) |
| `options.maxRetries` | Novas tentativas em erro da Bridge (padrão 2). Token recusado não conta |
| `options.streamUsage` | Pede o uso de tokens no streaming (`stream_options.include_usage`). Padrão desligado: a Bridge não documenta o parâmetro |
| `options.sendModelInBody` | Envia também o campo `model` no corpo (padrão desligado) |

## Credencial `bridgeApi` ("IA: Bridge")

| Campo | Descrição |
|---|---|
| `tokenUrl` | URL de login de serviço. Obrigatória, **sem valor padrão** |
| `baseUrl` | URL base do proxy de modelos. Obrigatória, **sem valor padrão** |
| `identificador` | Identificador do usuário de serviço |
| `senha` | Senha do usuário de serviço (secreta) |
| `tokenSkewSeconds` | Margem de renovação do token, em segundos (padrão 60, de 0 a 600) |
| `allowUnauthorizedCerts` | Não verificar o certificado TLS (padrão desligado) |

**Testar** faz o mesmo login da execução e mostra "Login bem-sucedido" ou o status com um trecho da resposta, sem a senha.

## Comportamento

- **Chamada (FR-003):** `POST <baseUrl>/deployments/{modelo}/chat/completions`, no formato `chat/completions` da OpenAI, com `Authorization: Bearer <token>`. O campo `model` não vai no corpo, a menos que `sendModelInBody` esteja ligado.
- **Token (FR-004):**
  - **login:** `POST tokenUrl { identificador, senha }` devolve `{ token }`;
  - **reaproveitamento:** o token fica em memória, em cada processo (API e workers), por credencial; alterar a credencial faz um novo login;
  - **renovação:** o token é renovado antes do `exp` do JWT menos a margem. Sem `exp` legível, vale 20 minutos menos a margem;
  - **logins simultâneos:** chamadas simultâneas da mesma credencial compartilham um só login.
- **Token recusado (FR-005):** em 401 ou 403, o token é descartado, um novo login é feito e a chamada é repetida **uma** vez.
- **Governança (FR-006):** o nó **não** consulta a lista de modelos permitidos (Administração › IA). O resto da governança vale:
  - limite mensal de tokens do projeto;
  - registro do uso com o provedor `bridge` e o nome do modelo, e do custo quando houver preço cadastrado para esse nome;
  - passos do agente e aprovação de ferramentas.
- **Uso de tokens com streaming:** com o streaming ligado e `streamUsage` desligado (os padrões), a Bridge não devolve o uso. O registro fica com 0 tokens, e o limite mensal não conta essas chamadas. Para medir o uso, ligue `streamUsage` (se o gateway aceitar) ou desligue o streaming.
- **Rede (FR-013):** as chamadas passam pelo filtro anti-SSRF, mas **aceitam endereços de rede privada sem a allowlist** (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7). Continuam barrados:
  - loopback;
  - link-local, inclusive o endereço de metadados da nuvem;
  - endereços reservados;
  - protocolos diferentes de HTTP e HTTPS.

  Uma Bridge na própria máquina (loopback) ainda exige `OLLY_HTTP_ALLOWLIST`.
- **TLS (FR-002):** com `allowUnauthorizedCerts`, só as chamadas desta credencial deixam de verificar o certificado. As regras de rede não mudam.
- **Segredos (FR-014):** a senha é um campo secreto, e cada token obtido entra no mascaramento da execução. Nenhum dos dois aparece em logs, dados de execução, passos do agente ou respostas da API.
- **Erros:**
  - **login recusado:** `Login na Bridge falhou com status <status>: <trecho>`;
  - **modelo inexistente ou outra falha da Bridge:** o status e a mensagem voltam na execução.

## Exemplo (trecho do JSON do workflow)

```json
{
  "name": "Bridge",
  "type": "ai.bridgeChatModel",
  "typeVersion": 1,
  "position": [300, 200],
  "parameters": { "model": "gemini-2.5-flash", "stream": true, "options": { "temperature": 0.2 } },
  "credentials": { "bridgeApi": { "id": "<id>", "name": "Bridge" } }
}
```

Ligue a saída `ai_languageModel` à entrada `ai_languageModel` do Agent (ver [workflow-json.md](workflow-json.md)).

## Divergências do N8N

- **Modelo padrão:** no N8N, o modelo vinha preenchido com `gemini-2.5-flash` e as credenciais tinham endereços padrão; aqui, os endereços e o modelo são sempre informados (na importação, o modelo omitido vira `gemini-2.5-flash`, como no N8N).
- **Opções `maxTokens` e `timeout`:** o `maxTokens: -1` do N8N vira `0`, e `timeout` vira `timeoutMs`.
- **Rede e governança:** a Bridge passa pelo filtro anti-SSRF da plataforma (com redes internas liberadas) e pela governança de IA.

Introduzido na [spec 016](../../specs/016-nos-bridge-agentix/spec.md) (FR-001 a FR-006, FR-013, FR-014).
