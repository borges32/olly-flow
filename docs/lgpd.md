# Proteção de dados pessoais (LGPD)

Mascaramento, política de dados das execuções e retenção. Introduzidos na [spec 009](../specs/009-governanca-lgpd-sso/spec.md) (constituição, Artigo VIII).

> **Pendências com o DPO.** Os prazos de retenção (padrões de 30 e 365 dias) e as regras de mascaramento adicionais exigidas pela instituição ainda não foram definidos. Os valores são configuráveis.

## Mascaramento (FR-014 a FR-016)

**Onde se aplica:** a tudo o que sai da execução para fora:
- log de execução no banco: entrada, saída, console do nó de código, mensagens de erro;
- objetos de dados no storage;
- eventos em tempo real (WebSocket);
- logs da aplicação (pino), tanto o objeto quanto a mensagem.

**Onde não se aplica:** aos dados que passam de um nó para o outro, que seguem com os valores reais (FR-015).

### Regras

| Tipo | `matcher` | Exemplo |
|---|---|---|
| Campo (`field`) | Glob sobre o nome do campo (`*token*`) ou, com ponto, sobre o caminho (`cliente.cpf`, `*.cpf`); sem diferenciar maiúsculas | Mascara o valor inteiro do campo, seja texto, número ou objeto |
| Padrão de valor (`pattern`) | Detector embutido: `cpf`, `cnpj`, `card`, `email`, `phone`, `jwt`, `apiKey` | Encontra e mascara ocorrências também dentro de textos livres e em números (CPF guardado como número) |

| Ação | Resultado |
|---|---|
| `redact` (ocultar) | `***` |
| `partial` (parcial) | CPF `***.***.247-**` · CNPJ `**.***.***/0001-**` · cartão `**** **** **** 1111` · e-mail `m***@exemplo.com` · telefone `(**) *****-5678` · outros: `***` + 4 últimos caracteres |
| `hash` | `sha256:` + SHA-256 de `OLLY_MASKING_SALT` + valor: o mesmo valor gera o mesmo hash, o que permite correlacionar sem revelar |

- **Sem falsos positivos óbvios:** CPF e CNPJ só são mascarados com dígito verificador válido, e cartões só com Luhn válido.
- **Ordem dos detectores:** JWT, chaves de API, e-mail, CNPJ, CPF, cartão, telefone.
- **Globs de campo amplos:** `*cpf*` também casa com `cpfConferido`. É uma escolha de segurança: na dúvida, mascara.

### Regras padrão (FR-016)

| Regra | Ação | Estado |
|---|---|---|
| Valor: CPF, CNPJ, cartão | Parcial | Ativa |
| Valor: JWT, chaves de API (`sk-…`, `AKIA…`) | Ocultar | Ativa |
| Campo: `*cpf*`, `*cnpj*` | Parcial | Ativa |
| Campo: `*password*`, `*senha*`, `*token*`, `*authorization*`, `*secret*` | Ocultar | Ativa |
| Valor: e-mail, telefone | Parcial | Disponível, **desativada** |

As regras padrão podem ser desativadas ou mudar de ação, mas não podem ser excluídas.

Além delas, há regras **globais** (Administração → Mascaramento) e **por projeto** (Administração → projeto → Governança). As mudanças valem na hora para a API e os workers (aviso pelo Redis) e são auditadas (`masking_rule.*`).

Regras com expressão regular livre não são aceitas, pelo risco de ReDoS no caminho de gravação. Padrões de valor novos entram como detectores embutidos.

### Efeitos colaterais

- A **execução parcial** do editor (spec 003, FR-020) não reaproveita nó cujos dados gravados foram alterados pelo mascaramento (coluna `node_executions.data_masked`) ou descartados pela política de dados: o nó executa de novo. Assim, valores mascarados nunca entram em outro nó.
- Os segredos das credenciais continuam sendo trocados por `***` como na spec 004. Além disso, `*authorization*` oculta o cabeçalho inteiro.

### Custo (NFR-002)

| Medida | Resultado |
|---|---|
| Teste automatizado | Mascarar 1.000 itens típicos tem custo da ordem da serialização JSON |
| Medição do relatório | Ver [report.md da spec 009](../specs/009-governanca-lgpd-sso/report.md) |

## Política de dados das execuções (FR-012, FR-013)

| Política | Execução de produção com sucesso | Com erro |
|---|---|---|
| `all` (padrão) | Dados gravados, mascarados | Dados gravados |
| `errorsOnly` | Só metadados: status, contagens, duração e erro. Os dados são apagados ao fim, inclusive os objetos no storage | Dados gravados |
| `none` | Só metadados; nem os eventos em tempo real levam dados | Só metadados |

- O padrão é do projeto (**Governança → Dados das execuções de produção**). Cada workflow pode sobrescrever em **Configurações → Dados das execuções de produção** (`settings.saveExecutionData`).
- **Execuções de teste** guardam sempre os dados, mascarados. O editor depende deles: pré-visualização de expressões e execução parcial. Elas seguem a retenção do projeto.
- **Dados grandes (FR-013):**
  - acima de `OLLY_INLINE_DATA_LIMIT` (256 KB de JSON por nó), entrada, saída e origens vão para o object storage em `executions/<id>/data/<nó>-<execução>.json` (`node_executions.data_ref`);
  - a API lê esses dados de forma transparente;
  - sem storage configurado, ficam no banco.

## Retenção (FR-017)

Job diário no worker (`OLLY_MAINTENANCE_CRON`, padrão `0 3 * * *` no fuso `OLLY_TIMEZONE`), agendado como *job scheduler* do BullMQ (um único agendamento para todos os workers), com lock no Redis (`olly:retention-lock`):

1. Cria as partições mensais futuras (`olly_ensure_partitions(2)`).
2. Por projeto, remove as execuções (metadados, nós, payloads, chamadas MCP da spec 010, passos do agente e pedidos de aprovação da spec 011 e objetos no storage) mais antigas que `retention.metadataDays`.
3. Por projeto, remove os **dados** (entrada, saída, origens, console, `data_ref`, objetos e o conteúdo dos passos do agente) das execuções mais antigas que `retention.dataDays`; os metadados ficam.
   Spec 011: remove as mensagens da memória persistente do agente mais antigas que `retention.memoryDays` (padrão `OLLY_RETENTION_MEMORY_DAYS`, 30).
4. Descarta (`DETACH` + `DROP`) as partições mensais que terminam antes da **maior** retenção de metadados entre os projetos.
5. Marca como inativos os usuários sem login há `OLLY_USER_INACTIVE_DAYS`.
6. Registra as contagens na auditoria (`retention.run`).

Execuções na fila, em andamento ou aguardando não são tocadas. Os padrões vêm de `OLLY_RETENTION_DATA_DAYS` (30) e `OLLY_RETENTION_METADATA_DAYS` (365); cada projeto pode definir os seus, e os dados nunca podem durar mais que as execuções. O job é idempotente: repetido, não remove mais nada.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_MASKING_SALT` | — (obrigatória em produção) | Salt da ação `hash`, por instalação. Mínimo 16 caracteres |
| `OLLY_INLINE_DATA_LIMIT` | 262144 | Bytes de JSON por nó acima dos quais os dados vão para o storage |
| `OLLY_RETENTION_DATA_DAYS` / `OLLY_RETENTION_METADATA_DAYS` | 30 / 365 | Retenção padrão |
| `OLLY_RETENTION_MEMORY_DAYS` | 30 | Retenção padrão da memória do agente (spec 011) |
| `OLLY_MAINTENANCE_CRON` | `0 3 * * *` | Horário do job diário |
| `OLLY_USER_INACTIVE_DAYS` | 90 | Inativação por falta de login |
