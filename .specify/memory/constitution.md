# Constituição do Olly Flow

> Princípios inegociáveis do projeto. Toda spec, plano, tarefa e linha de código deve respeitá-los. Em caso de conflito com qualquer outro documento, **a constituição prevalece**.
>
> **Versão:** 1.0.0 · **Ratificada em:** 03/10/2026

---

## Artigo I — Especificação antes do código

1. Nenhuma funcionalidade é implementada sem uma `spec.md` com status `Aprovada` em `specs/`.
2. A `spec.md` descreve **o quê** e **por quê**, sem detalhes de implementação. O **como** fica em `plan.md`. A ordem de execução fica em `tasks.md`.
3. Código e especificação nunca divergem. Se a implementação precisar mudar o comportamento especificado, a spec é atualizada **antes**, com registro no "Histórico de alterações".
4. Dúvidas são marcadas como `[PRECISA ESCLARECIMENTO: ...]` e resolvidas por um humano. **Nunca são preenchidas com suposições silenciosas.**

## Artigo II — Compatibilidade conceitual com o N8N

1. O modelo de dados entre nós é o do N8N: `[{ json, binary? }]`, com `pairedItem` para rastrear a origem dos itens.
2. As expressões usam a sintaxe do N8N: `{{ }}`, prefixo `=` em parâmetros, `$json`, `$input`, `$('Nó')`, `$node[...]`, `$now`...
3. Os nós de código JS e Python expõem a mesma API do N8N.
4. Divergências do N8N só são permitidas quando previstas na [ADR-0001](../../docs/adr/0001-abordagem-hibrida.md) ou em nova ADR aceita, e são documentadas na página do nó.
5. As fixtures da POC (`fixtures/n8n/`) são a referência de comportamento.

## Artigo III — Segurança por padrão

1. **Código e expressões de usuário** rodam somente em sandbox (isolated-vm para JS, nsjail para Python), sempre com limite de memória e de tempo. `vm`, `vm2` e `eval` são proibidos para conteúdo de usuário.
2. **SQL** é sempre parametrizado. Identificadores são validados contra o catálogo e escapados. Valores de usuário nunca são concatenados em SQL.
3. **Credenciais** são criptografadas em repouso (AES-256-GCM, *envelope encryption*). Nunca aparecem em respostas da API, logs, traces, mensagens de erro ou dados de execução.
4. **Toda rota da API** declara a permissão exigida. Rota sem declaração falha no teste de cobertura RBAC.
5. **Toda chamada de saída** (HTTP, MCP) passa pelo filtro anti-SSRF.
6. **Toda entrada externa** é validada com schema (zod) na fronteira.
7. **Agentes de IA** só usam tools explicitamente permitidas, com limite de passos. Ações destrutivas exigem aprovação humana.
8. É proibido desabilitar verificações de TLS, lint, testes ou controles de segurança para "fazer passar".

## Artigo IV — Testes como evidência

1. Todo requisito funcional (`FR-xxx`) tem pelo menos um teste automatizado que o comprova, e o teste cita o ID do requisito.
2. Todo critério de sucesso (`SC-xxx`) tem uma verificação objetiva: teste, comando ou medição registrada.
3. Os comandos de verificação do `AGENTS.md` passam ao final de cada spec. Uma spec com comando falhando não está implementada.
4. Toda correção de bug ou vulnerabilidade começa com um teste que reproduz o problema.

## Artigo V — Escopo disciplinado

1. O agente implementa **somente** o que está na spec em execução. Melhorias fora do escopo vão para "Próximos passos" no relatório.
2. Funcionalidade nova entra apenas por uma nova spec.

## Artigo VI — Decisões institucionais pertencem a humanos

1. ADRs que dependem da instituição (IdP, infraestrutura, cofre de segredos, provedores de LLM; hoje ADRs 0005–0008) não são decididas pelo agente.
2. Enquanto pendentes, o agente implementa atrás de uma **interface/adapter**, com uma implementação local de desenvolvimento, e registra a pendência.
3. O agente nunca inventa endpoints, credenciais ou configurações institucionais.
4. Aceitar risco de segurança (ex.: achado de pentest) é sempre decisão humana.

## Artigo VII — Rastreabilidade

1. A cadeia é sempre rastreável: requisito de produto (`PR-xx`) → requisito da spec (`FR-xxx`) → tarefa (`Txxx`) → teste → relatório.
2. Toda spec implementada tem um `report.md`, com entregas, desvios, decisões, dependências adicionadas e instruções de demonstração.
3. Ações de usuários (criar, editar, publicar, executar, alterar permissões e credenciais) são auditadas em log *append-only*.

## Artigo VIII — Privacidade e observabilidade

1. Toda execução de workflow é registrada (status, duração e itens por nó).
2. Dados pessoais e sensíveis são mascarados antes de persistir ou transmitir para logs, WebSocket, traces e métricas (LGPD). O mascaramento nunca altera os dados que trafegam entre os nós.
3. Dados de execução têm política de retenção.

## Artigo IX — Simplicidade

1. A stack é a definida em [`docs/arquitetura/stack.md`](../../docs/arquitetura/stack.md). Nova dependência exige justificativa (motivo e licença compatível) no relatório.
2. Prefira a solução mais simples que atenda à spec e à constituição. Nada de abstrações especulativas para "uso futuro".
3. Contratos centrais ([`docs/arquitetura/contratos.md`](../../docs/arquitetura/contratos.md)) só mudam com registro no plano e no relatório.

---

## Definition of Done (vale para toda spec)

- [ ] Todas as tarefas de `tasks.md` marcadas `[x]`, ou com justificativa no relatório.
- [ ] Todos os comandos de verificação do `AGENTS.md` passando.
- [ ] Todo `FR` com teste automatizado que o cita; todo `SC` verificado.
- [ ] Toda rota nova com permissão RBAC e teste de acesso negado.
- [ ] Nenhum segredo em código, log ou resposta da API.
- [ ] Documentação do nó/funcionalidade atualizada (`docs/nos/`, guias), quando aplicável.
- [ ] Migrations versionadas e reversíveis.
- [ ] `.env.example` e `README.md` atualizados.
- [ ] `report.md` escrito e status da spec atualizado.

## Governança

- Emendas à constituição exigem aprovação do tech lead e registro em uma ADR. A versão sobe seguindo o versionamento semântico: **major** quando um princípio é removido ou alterado de forma incompatível, **minor** quando um princípio é adicionado e **patch** para correções de redação.
- Revisões de código e de relatórios verificam a conformidade com esta constituição.
