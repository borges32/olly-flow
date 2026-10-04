# Expressões

Expressões permitem usar, num parâmetro de nó, dados de nós anteriores e funções JavaScript, com a mesma sintaxe do N8N ([ADR-0001](adr/0001-abordagem-hibrida.md)). Introduzidas na [spec 003](../specs/003-expressoes-execucao-teste/spec.md).

## Convenção

- Um parâmetro **string** iniciado por `=` é uma expressão-template. Qualquer outro valor é literal.
- Dentro do template, trechos `{{ ... }}` são código JavaScript (uma expressão; para instruções, use uma IIFE: `{{ (() => { ... })() }}`).
- **Um único trecho** (`={{ $json.idade }}`) devolve o valor com o tipo original: número, booleano, objeto, lista…
- **Template misto** (`=Olá {{ $json.nome }}!`) sempre produz texto. Em template misto:
  - `undefined` e `null` viram texto vazio;
  - objetos e listas viram JSON (`{"a":1}`);
  - datas (Luxon `DateTime` e `Date`) viram ISO 8601.
- Resultados de datas também viram ISO 8601 quando o trecho é único; funções viram `undefined`.
- `}}` dentro de strings (`{{ "}}" }}`) e chaves aninhadas (`{{ {a: {b: 1}} }}`) não fecham o trecho.

No editor, cada campo tem o alternador **Fixo | Expressão**. Em modo expressão, o campo mostra o template sem o `=`, sugere campos da última execução de teste (autocomplete), mostra a pré-visualização do resultado e aceita campos arrastados do painel de entrada.

## Variáveis

| Variável | O que é |
|---|---|
| `$json` | Campos do item atual (`$input.item.json`) |
| `$binary` | Binários do item atual (referências ao object storage) |
| `$itemIndex` | Índice do item atual |
| `$input.all()`, `.first()`, `.last()`, `.item`, `.params` | Itens de entrada do nó e seus parâmetros |
| `$('Nó').item` | Item **correspondente** no nó indicado, seguindo os *paired items* (funciona mesmo depois de um If que filtrou itens) |
| `$('Nó').all(saída?)`, `.first(saída?)`, `.last(saída?)` | Itens de uma saída do nó (0 = primeira; no If, 0 = Verdadeiro, 1 = Falso) |
| `$('Nó').itemMatching(i)`, `.params`, `.isExecuted` | Item correspondente ao item `i`, parâmetros do nó, se ele já executou |
| `$node["Nó"].json`, `$node.Nó.json` | Sintaxe legada do N8N: item de **mesmo índice** na primeira saída; `.parameter` traz os parâmetros |
| `$vars` | Variáveis da execução, gravadas pelo nó **Definir variável** (`data.setVariable`) |
| `$env` | Somente variáveis de ambiente com prefixo `OLLY_EXPOSED_`, sem o prefixo (`OLLY_EXPOSED_API_URL` → `$env.API_URL`) |
| `$execution.id`, `$execution.mode` | Execução atual (`test` ou `production`) |
| `$workflow.id`, `$workflow.name`, `$workflow.active` | Workflow atual |
| `$parameter` | Parâmetros do nó atual (sem resolver) |
| `$now`, `$today` | `DateTime` (Luxon) de agora e de hoje à meia-noite, no fuso `OLLY_TIMEZONE` (padrão `America/Sao_Paulo`) |
| `DateTime`, `Duration`, `Interval` | Classes do [Luxon](https://moment.github.io/luxon/) |

## Erros

Erros indicam o nó, o parâmetro, o item e o trecho, por exemplo:

```text
Erro na expressão do parâmetro "fields[0].value" do nó "Busca" (item 0): Cannot read properties of undefined (reading 'b')
Trecho: {{ $json.a.b }}
```

`$('Nó').item` falha com mensagem clara quando não há caminho de *paired items* até o nó (ex.: o nó não é ancestral, ou um nó no caminho não informou de qual item cada saída veio).

## Segurança e limites

As expressões são código do usuário e rodam **isoladas do servidor** ([ADR-0003](adr/0003-sandbox-javascript.md)):

- num isolate V8 (isolated-vm) dentro do processo `apps/task-runner`, separado da API e sem as variáveis de ambiente dela;
- sem `require`, `process`, módulos, rede ou sistema de arquivos;
- com timeout por expressão (`OLLY_EXPRESSION_TIMEOUT_MS`, padrão 100 ms) e limite de memória por execução (`OLLY_ISOLATE_MEMORY_MB`, padrão 128 MB). Um laço infinito é interrompido sem afetar a API;
- um isolate por execução: execuções não compartilham estado;
- os dados do item são somente leitura (alterações dentro da expressão não afetam outros itens).

As expressões de um nó são avaliadas em lote (todos os parâmetros × todos os itens), com só os nós referenciados copiados para o sandbox: 1000 itens × 3 expressões levam cerca de 80 ms.

## Divergências do N8N

| Ponto | N8N | Olly Flow |
|---|---|---|
| `$vars` | Variáveis globais da instância, somente leitura | Variáveis da execução, gravadas por `data.setVariable` |
| `null`/`undefined` em template misto | Pode variar entre versões | Sempre texto vazio |
| Funções de extensão (`.toTitleCase()`, `.isEmpty()`…) | Disponíveis | Ainda não implementadas |
| `$jmespath`, `$prevNode`, `$runIndex` | Disponíveis | Ainda não implementados (`$runIndex` chega com loops, spec 007) |

A suíte de compatibilidade (`packages/expressions/src/compat.test.ts`, mais de 70 casos) e as fixtures em `fixtures/` registram o comportamento esperado. Ela segue a documentação do N8N; quando os workflows reais da POC forem exportados, os casos deles entram como fixtures.
