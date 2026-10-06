# Modelo de chat (`ai.chatModel`)

Sub-nó do [Agente de IA](ai.agent.md): o modelo de linguagem que o agente usa. Um nó para todos os provedores; o provedor vem do tipo da credencial. Equivale aos nós "OpenAI Chat Model", "Anthropic Chat Model" e "Google Gemini Chat Model" do N8N.

| Item | Valor |
|---|---|
| Categoria | IA (sub-nó) |
| Saída | `ai_languageModel` (na base do Agent) |
| Credenciais | `openAiCompatible`, `anthropic`, `googleGemini` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `model` | Nome do modelo (ex.: `gpt-4o-mini`, `claude-sonnet-5-5`, `gemini-2.5-flash`). A lista do editor mostra os modelos permitidos no projeto |
| `temperature` | Opcional, 0 a 2. Vazio: o padrão do modelo (o valor não é enviado). Alguns modelos (ex.: `gpt-5`, `gpt-5-mini`) só aceitam o padrão |
| `topP` | Opcional, 0 a 1. Vazio: o padrão do modelo. Em geral ajuste a temperatura **ou** o top p; alguns modelos (ex.: Claude recentes) não aceitam top p |
| `maxTokens` | Máximo de tokens da resposta (0: o padrão do provedor) |
| `timeoutMs` | Tempo máximo de cada chamada (padrão 60 s) |
| `maxRetries` | Novas tentativas em erro transitório do provedor (padrão 2) |

## Provedores

| Credencial | Provedor | Observação |
|---|---|---|
| `openAiCompatible` | OpenAI ou qualquer API compatível | `baseURL` e `organization` opcionais (vLLM, Ollama, Azure com endpoint compatível etc.) |
| `anthropic` | Anthropic | |
| `googleGemini` | Google Gemini | Pelo endpoint compatível com OpenAI do Gemini |

## Comportamento

- **Parâmetros opcionais (FR-002):** temperatura e top p só vão ao provedor quando preenchidos. Se o modelo recusar o valor, o nó falha com a mensagem do provedor (ex.: `Unsupported value: 'temperature'`): deixe o campo vazio.

- **Lista permitida (FR-002):** o modelo precisa estar cadastrado em **Administração › IA › Modelos permitidos** (vale na hora, sem reiniciar) e, se o projeto restringir, na lista do projeto. Fora dela, o nó falha com `O modelo "<nome>" não está na lista permitida`. Lista vazia na instalação deixa o Agent indisponível.
- **Rede:** as chamadas ao provedor passam pelo filtro anti-SSRF; provedor interno precisa estar em `OLLY_HTTP_ALLOWLIST`.
- **Expressões:** os parâmetros podem usar o item atual do Agent.
- **Testes (FR-016):** com `NODE_ENV=test`, existe a credencial `fakeLlm` (modelo simulado com respostas e chamadas de ferramenta roteirizadas). Fora de testes, ela não é registrada e o nó recusa o provedor simulado.

## Divergências do N8N

- Um único nó para os provedores, em vez de um por provedor.
- A escolha dos provedores e modelos é institucional (ADR-0008): só os permitidos pela administração.

Introduzido na [spec 011](../../specs/011-ai-agent/spec.md) (FR-002, FR-016).
