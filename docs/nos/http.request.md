# Requisição HTTP (`http.request`)

Chama uma API HTTP para cada item de entrada, com autenticação por credencial, corpo e tratamento da resposta. Equivale ao `n8n-nodes-base.httpRequest` v4.

| Item | Valor |
|---|---|
| Categoria | Integração |
| Entradas | `main` |
| Saídas | `main` |
| Credenciais | `httpBearer`, `httpBasic`, `httpHeaderAuth`, `httpQueryAuth`, `oauth2ClientCredentials` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `method` | `GET` (padrão), `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` |
| `url` | URL `http` ou `https`. Aceita expressão |
| `authentication` | `none` ou `credential` (usa a credencial selecionada no nó) |
| `queryParameters[]`, `headers[]` | Listas de `{ name, value }` |
| `sendBody` + `contentType` | `json` (`jsonBody`: texto JSON ou expressão que produz um objeto), `form-urlencoded` e `multipart` (`bodyParameters[]`; no multipart, `parameterType: binary` envia a propriedade binária do item), `raw` (`rawBody`, `rawContentType`), `binary` (`inputBinaryField`) |
| `options.timeout` | Em ms; padrão 30 000 |
| `options.followRedirects`, `options.maxRedirects` | Padrão: segue até 5 |
| `options.fullResponse` | Saída `{ statusCode, statusMessage, headers, body }` |
| `options.responseFormat` | `auto` (padrão: JSON pelo `content-type`, texto para `text/*`, XML e afins, binário para o resto), `json`, `text`, `binary` |
| `options.outputBinaryField` | Propriedade binária da saída (padrão `data`) |
| `options.neverError` | Status 4xx/5xx viram saída normal |
| `options.batchSize`, `options.batchIntervalMs` | Requisições simultâneas por lote (padrão 1, uma por vez) e espera entre lotes |

## Comportamento

- **Uma requisição por item**, com os parâmetros resolvidos para o item; cada saída aponta o item de origem (`pairedItem`).
- **Resposta:** lista JSON de objetos vira um item por elemento; objeto JSON vira um item; texto vai para `json.data`.
- **Binário:** o conteúdo vai para o object storage (MinIO/S3) e o item guarda só a referência em `binary.<campo>` (`{ id, mimeType, fileName, size }`).
- **Limite de resposta:** `OLLY_HTTP_MAX_RESPONSE_MB` (padrão 50 MB); acima disso a requisição é abortada.
- **Status ≥ 400** (sem `neverError`): erro com o código e um trecho do corpo (até 500 caracteres).
- **Filtro anti-SSRF:** toda requisição e todo redirect passam pelo filtro. Destinos em loopback, redes privadas, link-local (inclusive `169.254.169.254`), CGNAT, ULA, endereço não especificado, reservados ou multicast são bloqueados com a mensagem `Destino bloqueado pelo filtro de rede (host): motivo`. O filtro valida cada IP resolvido no momento da conexão, o que impede DNS rebinding. Hosts e CIDRs internos podem ser liberados em `OLLY_HTTP_ALLOWLIST`.
- **Redirect para outra origem:** os cabeçalhos `Authorization` e `Cookie` não são reenviados.
- **OAuth2 client credentials:** o token é obtido no servidor de autorização (também pelo filtro) e reaproveitado em memória até 30 s antes de vencer. Alterar a credencial invalida o token.
- **`onError: continue`:** o item que falha vira `{ json: { error: { message, description, httpCode } } }` e os demais seguem.
- **Timeout e cancelamento:** interrompem a requisição em andamento.

## Divergências do N8N

- O filtro anti-SSRF não existe no N8N; aqui é obrigatório (constituição III.5).
- Paginação fica para a spec 008.

Introduzido na [spec 004](../../specs/004-credenciais-http-postgres/spec.md) (FR-008 a FR-010).
