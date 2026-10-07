# Nó não suportado (`placeholder.unsupported`)

Marcador criado pela **importação de workflows** ([spec 015](../../specs/015-exportar-importar-json/spec.md), FR-016) no lugar de um nó que o Olly Flow não suporta:
- um tipo desconhecido num arquivo do Olly Flow (por exemplo, de uma instalação com outros nós);
- um tipo do N8N sem conversão, ou numa versão não mapeada ([importação do N8N](../importacao-n8n.md)).

Ele preserva o conteúdo original para que nada se perca, e mostra no canvas onde o workflow precisa de ajuste.

| Item | Valor |
|---|---|
| Categoria | Fluxo |
| Entradas | `in0`, `in1`... (as das conexões originais; padrão: uma `main`) |
| Saídas | `out0`, `out1`... (as das conexões originais; padrão: uma `main`). Podem ser de sub-nó (`ai_tool` etc.) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `originalType`, `originalTypeVersion` | Tipo e versão do nó original |
| `reason` | Por que o nó não foi convertido |
| `originalJson` | O nó original em JSON (sem as credenciais), só para leitura no painel |
| `ports` | `{ inputs, outputs }`: tipos de conexão das portas, oculto no painel |

## Comportamento

- **Na importação:** chega **desabilitado**: repassa a primeira entrada para a primeira saída, como qualquer nó desabilitado. Com saídas só de sub-nó, fica fora do fluxo principal.
- **No canvas:** borda tracejada âmbar e o subtítulo "Não suportado: <tipo original>".
- **Na publicação:** bloqueada enquanto houver marcadores (erro `UNSUPPORTED_NODE`). O rascunho pode ser salvo normalmente.
- **Habilitado à mão:** falha ao executar, com a mensagem "Nó não suportado (<tipo>)".
- **Como resolver:** substitua o marcador por um nó equivalente do Olly Flow (ou remova-o), religue as conexões e publique.
