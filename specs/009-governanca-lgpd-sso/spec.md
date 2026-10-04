# Spec 009 — Governança: cofre, SSO institucional, versionamento e LGPD

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 3 — IA e governança |
| **Depende de** | 008 |
| **Requisitos de produto** | PR-19, PR-18, PR-08 (SSO), PR-07 (retenção) |
| **ADRs relacionadas** | 0005, 0007 |

## Contexto e problema

A plataforma precisa atender aos requisitos institucionais:
- segredos sob gestão corporativa;
- login com as contas da instituição e papéis vindos dos grupos do diretório;
- rastreabilidade de alterações;
- aprovação para publicar;
- proteção de dados pessoais nos registros (LGPD).

## Histórias de usuário

### HU-1 — Login institucional com papéis automáticos (P1)

Como **usuário da instituição**, quero entrar com minha conta e já ter os papéis definidos pelo meu grupo no diretório.

**Cenários de aceite:**
1. **Dado** um usuário no grupo mapeado para Editor do projeto X, **quando** faz login, **então** é editor em X.
2. **Dado** um usuário removido do grupo, **quando** faz login novamente, **então** perde o papel herdado, mas mantém os vínculos manuais.

### HU-2 — Segredos sob o cofre corporativo (P1)

Como **segurança da informação**, quero que a chave mestra das credenciais fique no cofre corporativo, com rotação.

### HU-3 — Histórico e comparação de versões (P1)

Como **editor**, quero ver o histórico de um workflow, comparar versões visualmente e restaurar uma anterior.

### HU-4 — Aprovação para publicar (P2)

Como **gestor**, quero que publicações em produção exijam a aprovação de outra pessoa.

**Cenários de aceite:**
1. **Dado** um projeto com aprovação ativa, **quando** o autor pede publicação, **então** outro usuário com permissão precisa aprovar. O próprio autor não consegue.

### HU-5 — Proteção de dados pessoais (P1)

Como **encarregado de dados (DPO)**, quero que CPF, senhas, tokens e similares apareçam mascarados nos registros e que os dados antigos sejam removidos.

**Cenários de aceite:**
1. **Dado** um payload com CPF, **quando** consulto a execução, **então** vejo o CPF mascarado, mas o nó seguinte recebeu o valor original.
2. **Dado** execuções mais antigas que a retenção, **quando** o job diário roda, **então** os dados são removidos e a remoção é auditada.

### HU-6 — Consultar a auditoria (P2)

Como **auditor**, quero filtrar e exportar a auditoria.

### Casos de borda

- Rotação de chave interrompida no meio: pode ser retomada sem perda.
- CPF no meio de um texto livre é mascarado.
- Exportação com 100 mil registros não estoura a memória.

## Requisitos funcionais

- **FR-001**: A chave mestra DEVE poder vir do cofre corporativo definido na ADR-0007, selecionável por configuração, sem token fixo em código.
- **FR-002**: DEVE existir uma rotação de chave idempotente e retomável, que recifra as chaves das credenciais e é auditada.
- **FR-003**: DEVE existir uma migração das credenciais do provedor local para o cofre.
- **FR-004**: O login DEVE funcionar com o IdP institucional (ADR-0005).
- **FR-005**: O sistema DEVE mapear grupos do IdP para papéis globais ou por projeto, sincronizando os vínculos no login sem remover os vínculos manuais.
- **FR-006**: Usuários desativados no IdP DEVEM perder o acesso. Usuários sem login há N dias DEVEM ser marcados como inativos.
- **FR-007**: Logins e falhas de login DEVEM ser auditados.
- **FR-008**: O sistema DEVE listar versões (autor, data, mensagem), exibir uma versão, comparar duas versões (nós e arestas adicionados, removidos e alterados, com diff de parâmetros) e restaurar uma versão como nova versão.
- **FR-009**: A mensagem de versão DEVE ser opcional ao salvar e obrigatória ao publicar.
- **FR-010**: O editor DEVE mostrar o diff visual no canvas.
- **FR-011**: QUANDO a aprovação estiver ativa no projeto, a publicação DEVE gerar um pedido que só outro usuário com permissão pode aprovar ou rejeitar, com comentário e notificação na aplicação.
- **FR-012**: Cada workflow DEVE ter a política de dados de execução: salvar tudo, só erros ou nada (somente metadados).
- **FR-013**: Payloads acima de um limite DEVEM ser armazenados no object storage, com leitura transparente.
- **FR-014**: O sistema DEVE mascarar dados sensíveis por nome de campo e por padrão de valor (CPF, CNPJ, e-mail, cartão, telefone, JWT, chaves de API), com as ações ocultar, parcial ou hash, antes de persistir, transmitir por WebSocket ou registrar em log.
- **FR-015**: O mascaramento NÃO DEVE alterar os dados que trafegam entre os nós.
- **FR-016**: Regras padrão (CPF, CNPJ, senha, token, authorization, cartão) DEVEM vir ativas, com regras adicionais globais e por projeto.
- **FR-017**: Um job diário DEVE criar partições futuras e remover os dados e metadados expirados conforme a retenção por projeto, incluindo os objetos no storage, auditando o que removeu.
- **FR-018**: O sistema DEVE oferecer consulta e exportação CSV (em *streaming*) da auditoria, restrita a `audit:read`.
- **FR-019**: Cada projeto DEVE poder definir se o papel Executor vê os dados das execuções.

## Requisitos não funcionais

- **NFR-001**: A rotação de chave não exige parada do serviço.
- **NFR-002**: O mascaramento adiciona menos de 10% ao tempo de gravação de execuções típicas.

## Entidades-chave

- **Mapeamento grupo → papel**, **Pedido de publicação**, **Regra de mascaramento**, **Política de retenção**.

## Critérios de sucesso

- **SC-001**: Login com usuário do IdP atribui o papel pelo grupo.
- **SC-002**: Credenciais funcionam com o cofre; a rotação recifra tudo sem downtime.
- **SC-003**: CPF mascarado no banco, no WebSocket e nos logs; original preservado entre os nós.
- **SC-004**: A política "só erros" não guarda os dados de execuções com sucesso.
- **SC-005**: O diff mostra as alterações; restaurar cria uma nova versão.
- **SC-006**: O autor não aprova o próprio pedido.
- **SC-007**: A retenção remove o que expirou e audita.
- **SC-008**: Exportação de 100 mil registros sem estouro de memória.

## Fora do escopo

MCP, AI Agent, notificações por e-mail e Kubernetes.

## Pré-requisitos humanos

- ADR-0005 e ADR-0007 decididas, com acessos de homologação. Se não estiverem, usar Keycloak e Vault locais e registrar a pendência.

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: prazos de retenção exigidos pela instituição (dados e metadados)?] Os padrões são 30 e 365 dias.
- [PRECISA ESCLARECIMENTO: regras de mascaramento adicionais exigidas pelo DPO?]

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 8 | Migração para SDD |
| 03/10/2026 | Permissões RBAC explicitadas no plano (seção e tarefa T089), sem mudança de requisito | Decisão humana sobre permissões por spec |
