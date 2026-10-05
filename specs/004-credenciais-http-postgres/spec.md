# Spec 004 — Credenciais, HTTP Request e PostgreSQL

| Campo | Valor |
|---|---|
| **Status** | Verificada |
| **Fase** | 1 — MVP |
| **Depende de** | 003 |
| **Requisitos de produto** | PR-03, PR-04, PR-05, PR-18 |
| **ADRs relacionadas** | 0007 (adapter local nesta spec) |

## Contexto e problema

Os workflows precisam integrar APIs e bancos PostgreSQL da instituição. Credenciais são dados sensíveis. Chamadas HTTP de saída podem ser usadas para atacar a rede interna (SSRF). Comandos SQL podem ser alvo de injeção.

## Histórias de usuário

### HU-1 — Guardar credenciais com segurança (P1)

Como **editor**, quero cadastrar credenciais de APIs e bancos uma vez e usá-las nos nós, sem que os segredos fiquem visíveis.

**Cenários de aceite:**
1. **Dado** uma credencial salva, **quando** abro para editar, **então** os campos secretos aparecem mascarados e, se ficarem em branco, mantêm o valor atual.
2. **Dado** uma credencial, **quando** clico em "Testar", **então** vejo se a conexão funciona.
3. **Dado** qualquer execução ou log, **quando** procuro o valor do segredo, **então** ele não aparece em lugar nenhum.

### HU-2 — Chamar APIs (P1)

Como **editor**, quero um nó HTTP Request com métodos, corpo, headers, autenticação e tratamento da resposta.

**Cenários de aceite:**
1. **Dado** uma API pública, **quando** configuro um GET com autenticação Bearer, **então** cada item de entrada gera uma requisição e o resultado aparece na saída.
2. **Dado** uma URL que aponta para a rede interna não liberada, **quando** executo, **então** a requisição é bloqueada com mensagem clara.

### HU-3 — Consultar e gravar no PostgreSQL (P1)

Como **editor**, quero consultar com SQL parametrizado e inserir/atualizar registros mapeando campos para colunas.

**Cenários de aceite:**
1. **Dado** uma query com `$1`, **quando** passo o parâmetro por expressão, **então** o valor é tratado como dado, nunca como SQL.
2. **Dado** itens de entrada, **quando** uso "Inserir" com mapeamento automático, **então** cada campo vai para a coluna de mesmo nome.
3. **Dado** a opção transacional, **quando** um item falha, **então** nenhum item é gravado.

### HU-4 — Resiliência por nó (P2)

Como **editor**, quero configurar novas tentativas, timeout e o comportamento em caso de erro em cada nó.

### Casos de borda

- O DNS resolve para um IP privado (DNS rebinding): a requisição é bloqueada.
- Um redirect aponta para um IP interno: o redirect é bloqueado.
- Credencial somente leitura usada em comando de escrita: o comando falha.

## Requisitos funcionais

- **FR-001**: Credenciais DEVEM ser cifradas em repouso com uma chave por credencial, protegida por uma chave mestra obtida por um provedor substituível.
- **FR-002**: Respostas da API NÃO DEVEM conter valores secretos de credenciais.
- **FR-003**: Valores secretos NÃO DEVEM aparecer em logs, mensagens de erro ou dados de execução.
- **FR-004**: O sistema DEVE suportar credenciais dos tipos: Bearer, Basic, header, query, OAuth2 client credentials e PostgreSQL (incluindo SSL e modo somente leitura).
- **FR-005**: O sistema DEVE permitir testar uma credencial.
- **FR-006**: Criação, alteração, exclusão e teste de credencial DEVEM ser auditados, sem os valores.
- **FR-007**: O uso de credencial em nós DEVE exigir a permissão `credential:use`; a gestão, `credential:manage`.
- **FR-008**: Toda chamada HTTP de saída DEVE ser bloqueada quando qualquer IP resolvido ou destino de redirect for loopback, privado, link-local, CGNAT, ULA ou não especificado, salvo allowlist configurada.
- **FR-009**: O nó `http.request` DEVE suportar: métodos, query, headers, corpos (JSON, form, multipart, raw, binário), autenticação por credencial, timeout, redirects, resposta completa, formato de resposta, opção de não falhar em status de erro e envio em lotes. Executa uma requisição por item.
- **FR-010**: Respostas binárias DEVEM ser armazenadas no object storage e referenciadas no item.
- **FR-011**: O nó `postgres.query` DEVE executar SQL com parâmetros posicionais vindos de expressões, uma vez para todos os itens ou por item, com limite de linhas e timeout de comando.
- **FR-012**: O sistema NÃO DEVE aceitar expressões no texto SQL. Valores entram somente como parâmetros.
- **FR-013**: QUANDO a credencial for somente leitura, as consultas DEVEM rodar em transação somente leitura.
- **FR-014**: O nó `postgres.write` DEVE suportar inserir, atualizar e upsert, com mapeamento automático ou manual de colunas, colunas de correspondência, inserção em lote, retorno das linhas e opção transacional (tudo ou nada).
- **FR-015**: Identificadores (schema, tabela, colunas) DEVEM ser validados contra o catálogo do banco e escapados.
- **FR-016**: O editor DEVE listar schemas, tabelas e colunas do banco da credencial.
- **FR-017**: Cada nó DEVE aceitar configuração de novas tentativas (quantidade, espera, backoff fixo ou exponencial), timeout e comportamento em erro (`stop` ou `continue`).
- **FR-018**: O timeout e o cancelamento DEVEM interromper efetivamente a operação HTTP ou SQL em andamento.

## Requisitos não funcionais

- **NFR-001**: Limite padrão de resposta HTTP de 50 MB; timeout padrão de 30 s.
- **NFR-002**: Pool de conexões Postgres por credencial, com tamanho máximo configurável.

## Entidades-chave

- **Credencial**: nome, tipo, projeto, dados cifrados, versão da chave.
- **Tipo de credencial**: schema dos campos, com marcação de campos secretos.

## Critérios de sucesso

- **SC-001**: E2E `Manual → HTTP → Postgres Insert → Postgres Query` funciona pelo editor.
- **SC-002**: Uma varredura automática não encontra segredos nas respostas, nos logs ou em `node_executions`.
- **SC-003**: Os destinos de rede interna listados no plano são bloqueados.
- **SC-004**: O valor `'; DROP TABLE x; --` é tratado como dado.
- **SC-005**: `transaction: allItems` faz rollback completo em caso de falha.
- **SC-006**: Timeout cancela uma query longa.

## Fora do escopo

Webhook, código JS, fila, Vault/KMS (spec 009), paginação HTTP (spec 008), OAuth2 Authorization Code (spec 010) e porta de erro (spec 007).

## Pré-requisitos humanos

Nenhum.

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: hosts/CIDRs internos que devem constar na allowlist inicial de homologação] O padrão é allowlist vazia.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 3 | Migração para SDD |
| 03/10/2026 | Permissões RBAC explicitadas no plano (seção e tarefa T089), sem mudança de requisito | Decisão humana sobre permissões por spec |
