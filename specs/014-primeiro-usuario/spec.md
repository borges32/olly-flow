# Spec 014 — Primeiro usuário, usuários locais e IdP opcional

| Campo | Valor |
|---|---|
| **Status** | Implementada (pendente: validação da Segurança para o login local) |
| **Fase** | 1 — MVP (apoio à validação de UX) |
| **Depende de** | 002, 009 |
| **Requisitos de produto** | PR-08 (parcial), PR-20 (parcial); altera a NFR-G03 |
| **ADRs relacionadas** | 0005 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje o único caminho de entrada no Olly Flow é uma conta no provedor de identidade (IdP) institucional, e o administrador global é quem pertence ao grupo de administração desse IdP. Numa instalação nova, quem abre a plataforma vê apenas "Entrar com conta institucional", não sabe com qual conta entrar, nem como se tornar administrador. Além disso, a plataforma não funciona sem um IdP configurado, o que dificulta a validação da UX, os ambientes de demonstração e as instalações em que o IdP ainda não está disponível.

Decisão do PO (06/10/2026): a plataforma passa a ter **usuários locais** (nome, e-mail e senha) como forma de entrada padrão. O **login pelo IdP** passa a ser opcional: pode ser ativado ou desativado e, por padrão, fica **desativado**. Na primeira subida, a plataforma conduz o cadastro do **primeiro usuário**, que recebe a administração global, como a configuração do "proprietário" do N8N.

## Histórias de usuário

### HU-1 — Cadastrar o primeiro usuário numa instalação nova (Prioridade: P1)

Como **primeira pessoa a acessar uma instalação nova**, quero **cadastrar o primeiro usuário pela tela de entrada** para **entrar e configurar a plataforma sem depender de outra equipe nem de um IdP**.

**Teste independente:** em uma instalação sem usuários, abrir a plataforma, cadastrar o primeiro usuário, entrar e criar um projeto.

**Cenários de aceite:**
1. **Dado** uma instalação sem nenhum usuário, **quando** abro a plataforma, **então** sou levado ao cadastro do primeiro usuário.
2. **Dado** que cadastrei o primeiro usuário, **quando** entro com o e-mail e a senha, **então** chego à tela inicial como administrador global e consigo criar projetos.
3. **Dado** que já existe ao menos um usuário, **quando** abro a plataforma, **então** o cadastro do primeiro usuário não aparece.
4. **Dado** que já existe ao menos um usuário, **quando** alguém tenta cadastrar outro "primeiro usuário" diretamente pela API, **então** a operação é recusada.

### HU-2 — Entrar com usuário e senha locais (Prioridade: P1)

Como **usuário da plataforma**, quero **entrar com meu e-mail e senha** para **usar a plataforma sem conta no IdP institucional**.

**Teste independente:** com um usuário local cadastrado, entrar, navegar, sair e confirmar que a sessão encerrada não dá mais acesso.

**Cenários de aceite:**
1. **Dado** um usuário local ativo, **quando** informo e-mail e senha corretos, **então** entro na plataforma com as permissões dos meus papéis.
2. **Dado** uma senha incorreta, **quando** tento entrar, **então** vejo uma mensagem genérica, que não revela se o e-mail existe.
3. **Dado** várias tentativas erradas seguidas para o mesmo e-mail, **quando** tento de novo, **então** a entrada é bloqueada temporariamente.
4. **Dado** que saí da plataforma ou que a sessão expirou, **quando** acesso uma página ou a API, **então** preciso entrar de novo.
5. **Dado** um usuário desativado, **quando** tenta entrar ou usar uma sessão aberta, **então** o acesso é negado.

### HU-3 — Administrar usuários locais (Prioridade: P1)

Como **administrador da plataforma**, quero **criar, editar, desativar e redefinir a senha de usuários locais** para **dar acesso às demais pessoas sem um IdP**.

**Teste independente:** como administrador, criar um usuário local, incluí-lo num projeto como editor e confirmar que ele entra e edita workflows do projeto.

**Cenários de aceite:**
1. **Dado** que sou administrador da plataforma, **quando** crio um usuário local com nome, e-mail e senha inicial, **então** ele consegue entrar e precisa trocar a senha no primeiro acesso.
2. **Dado** um usuário local, **quando** o desativo, **então** ele perde o acesso imediatamente, e o histórico (auditoria, execuções, autoria) é preservado.
3. **Dado** um usuário que esqueceu a senha, **quando** redefino a senha dele, **então** ele entra com a nova senha e precisa trocá-la no próximo acesso.
4. **Dado** que sou um usuário comum, **quando** tento administrar usuários, **então** a operação é recusada.
5. **Dado** que sou um usuário local, **quando** troco a minha senha informando a atual, **então** a nova senha passa a valer.

### HU-4 — Ativar ou desativar o login pelo IdP (Prioridade: P2)

Como **responsável pela plataforma**, quero **ativar ou desativar o login pelo IdP institucional** para **usar as contas da instituição quando o IdP estiver disponível, sem perder o acesso local**.

**Teste independente:** com o IdP desativado, a tela de entrada mostra só o login local; ao ativar, aparece também "Entrar com conta institucional", e um usuário do IdP entra com os papéis dos seus grupos.

**Cenários de aceite:**
1. **Dado** uma instalação nova, **quando** abro a tela de entrada, **então** só o login local aparece (IdP desativado por padrão).
2. **Dado** o IdP ativado, **quando** abro a tela de entrada, **então** vejo o login local e a opção "Entrar com conta institucional".
3. **Dado** o IdP ativado, **quando** um usuário do IdP entra, **então** a plataforma o reconhece e aplica os papéis dos seus grupos (spec 009).
4. **Dado** o IdP desativado depois de usado, **quando** um usuário que só existe no IdP tenta entrar, **então** o acesso é negado, e o histórico dele é preservado.

### Casos de borda

- Duas pessoas tentam cadastrar o primeiro usuário ao mesmo tempo: só uma consegue; a outra é informada de que a instalação já foi configurada.
- A instalação é zerada (banco apagado) depois de configurada: o cadastro do primeiro usuário volta a aparecer.
- O último administrador global tenta se desativar ou perder a administração: a operação é recusada, para a plataforma nunca ficar sem administrador.
- O IdP está ativado mas fora do ar: o login local continua funcionando.
- E-mail repetido: dois usuários não podem ter o mesmo e-mail. Com o IdP ativado, uma conta do IdP com o mesmo e-mail de um usuário local é **vinculada** a ele (mesma pessoa: entra pelos dois caminhos), desde que o IdP declare o e-mail como verificado; sem essa garantia, a entrada pelo IdP é recusada e auditada.
- Instalação existente (só usuários do IdP) atualizada com o IdP desativado: ninguém tem senha local. O operador do servidor recupera o acesso criando um administrador local por um comando no servidor (FR-015), ou ativa o IdP.

## Requisitos funcionais

- **FR-001**: QUANDO não houver nenhum usuário na plataforma, o sistema DEVE oferecer o cadastro do primeiro usuário (nome, e-mail e senha) e NÃO DEVE oferecer outra forma de entrada até ele ser concluído.
- **FR-002**: O cadastro do primeiro usuário DEVE ser aceito uma única vez. Com ao menos um usuário existente, NÃO DEVE ser oferecido nem aceito, inclusive em requisições simultâneas.
- **FR-003**: O primeiro usuário DEVE receber a administração global da plataforma.
- **FR-004**: Os usuários locais DEVEM entrar com e-mail e senha e sair quando quiserem. A sessão DEVE expirar por inatividade e por tempo máximo.
- **FR-005**: Após um número de tentativas erradas para o mesmo e-mail, a entrada DEVE ser bloqueada temporariamente. As mensagens de erro NÃO DEVEM revelar se o e-mail existe.
- **FR-006**: A administração da plataforma DEVE poder criar, editar (nome, e-mail), desativar, reativar e redefinir a senha de usuários locais, e conceder ou retirar a administração global.
- **FR-007**: Senhas definidas pela administração (criação e redefinição) DEVEM ser trocadas pelo próprio usuário no primeiro acesso. Todo usuário local DEVE poder trocar a própria senha informando a atual.
- **FR-008**: Usuários desativados NÃO DEVEM conseguir entrar nem usar sessões já abertas. A desativação NÃO DEVE apagar o histórico do usuário.
- **FR-009**: A plataforma NÃO DEVE ficar sem ao menos um administrador global ativo.
- **FR-010**: O login pelo IdP DEVE ser ativado ou desativado pela configuração da instalação (variável de ambiente) e DEVE vir desativado por padrão. Com ele desativado, a tela de entrada mostra só o login local, as contas do IdP não entram e as configurações do IdP não são exigidas. A tela de administração mostra se o IdP está ativado, sem alterá-lo.
- **FR-011**: Com o IdP ativado, os usuários do IdP DEVEM entrar como hoje, com os papéis vindos dos grupos (spec 009), e o login local DEVE continuar disponível para todos os usuários locais.
- **FR-015**: QUANDO o IdP entrar com um e-mail igual ao de um usuário local, o sistema DEVE vincular a conta do IdP a esse usuário (a mesma pessoa entra pelos dois caminhos e mantém projetos e histórico), desde que o IdP declare o e-mail como verificado; caso contrário, DEVE recusar a entrada pelo IdP. A vinculação DEVE ser auditada.
- **FR-016**: O operador do servidor DEVE poder criar um administrador local (ou redefinir a senha de um) por um comando executado no servidor, para recuperar o acesso quando nenhum administrador consegue entrar.
- **FR-012**: Os papéis e as permissões por projeto (RBAC) DEVEM valer igualmente para usuários locais e do IdP.
- **FR-013**: DEVEM ser auditados: o cadastro do primeiro usuário, entradas (com sucesso e com falha), bloqueios, criação, edição, desativação, reativação e redefinição de senha de usuários, mudanças de administração global e a ativação ou desativação do IdP.
- **FR-014**: A tela de usuários da administração DEVE mostrar a origem de cada usuário (local ou IdP), a situação (ativo, desativado, bloqueado) e o último acesso.

## Requisitos não funcionais

- **NFR-001**: As senhas DEVEM ter no mínimo 12 caracteres, NÃO DEVEM estar numa lista de senhas comuns nem conter o e-mail do usuário e NÃO expiram periodicamente.
- **NFR-002**: As senhas NÃO DEVEM ser armazenadas de forma reversível e NÃO DEVEM aparecer em logs, respostas da API, auditoria ou telemetria.
- **NFR-003**: Sem código de instalação (decisão do PO): enquanto o primeiro usuário não for cadastrado, quem chegar primeiro à tela vira administrador. Risco aceito pelo PO em 06/10/2026; mitigação operacional: cadastrar o primeiro usuário logo após a instalação, antes de expor a plataforma.
- **NFR-004**: Limites padrão: sessão de 8 horas de inatividade e 24 horas no máximo; bloqueio de 15 minutos após 5 tentativas erradas. Todos configuráveis.

## Entidades-chave

- **Instalação**: estado da plataforma quanto à configuração inicial (sem usuários / configurada).
- **Usuário**: pessoa com acesso à plataforma; origem (local ou IdP), situação (ativo, desativado, bloqueado), se é administrador global, último acesso e, se local, se precisa trocar a senha.
- **Sessão**: acesso autenticado de um usuário, com início, último uso e expiração.
- **Configuração de autenticação**: se o login pelo IdP está ativado.

## Critérios de sucesso

- **SC-001**: Em uma instalação zerada, uma pessoa sem orientação prévia cadastra o primeiro usuário, entra e cria um projeto em menos de 3 minutos, sem nenhum IdP configurado.
- **SC-002**: Com um usuário existente, nem a UI nem a API aceitam um novo cadastro inicial, inclusive com requisições simultâneas.
- **SC-003**: Um usuário local criado pela administração entra, troca a senha e trabalha num projeto conforme o seu papel.
- **SC-004**: Um usuário desativado perde o acesso, inclusive com uma sessão aberta, em até 1 minuto.
- **SC-005**: Nenhuma senha (valor sentinela) aparece em logs, respostas, banco em texto claro, auditoria ou telemetria.
- **SC-006**: Com o IdP desativado (padrão), a opção institucional não aparece e as contas do IdP não entram; com ele ativado, os usuários do IdP entram com os papéis dos seus grupos e o login local continua funcionando.
- **SC-007**: Com o IdP ativado, um usuário do IdP com o mesmo e-mail (verificado) de um usuário local entra como esse usuário, com os mesmos projetos; sem e-mail verificado, a entrada é recusada.
- **SC-008**: Numa instalação sem administrador acessível, o comando do servidor cria um administrador local que consegue entrar.

## Fora do escopo

- Autocadastro (pessoas criando a própria conta), convites por e-mail e recuperação de senha por e-mail (a redefinição é feita pela administração).
- Autenticação em dois fatores (MFA) para usuários locais.
- Sincronização de usuários e grupos com o diretório institucional além do que a spec 009 já faz.
- Outros protocolos de IdP além de OIDC.

## Pré-requisitos humanos

- ~~Atualizar a NFR-G03 e registrar a mudança na ADR-0005~~ (feito em 06/10/2026, por decisão do PO).
- Validação da Segurança para o login local (política de senha, bloqueio, sessão, vinculação por e-mail e o risco aceito da NFR-003).

## Pontos em aberto

- Nenhum. Respondidos pelo PO em 06/10/2026: IdP ativado por variável de ambiente; login local continua com o IdP ativado; e-mails iguais são vinculados; política de senha proposta mantida; sem código de instalação.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação | Pedido do usuário após testar a UX com a instalação zerada: não havia caminho para o primeiro acesso |
| 06/10/2026 | Revisão completa no formato de `.specify/templates/spec-template.md`: usuários locais como entrada padrão; primeiro usuário local com administração global; administração de usuários locais (HU-3); login pelo IdP opcional e desativado por padrão (HU-4); requisitos e critérios renumerados; resolvido o ponto "credencial no IdP ou local" (local); status de volta a Rascunho | Decisão do PO: a plataforma deve funcionar sem IdP, com o IdP como opção |
| 06/10/2026 | Esclarecimentos do PO: IdP por variável de ambiente (FR-010); login local para todos com o IdP ativado (FR-011); vinculação de e-mails iguais, condicionada ao e-mail verificado pelo IdP (FR-015, SC-007); política de senha (NFR-001); sem código de instalação, risco aceito (NFR-003). Acrescentados o comando de recuperação do operador (FR-016, SC-008) e o caso das instalações existentes | Esclarecimento (etapa Esclarecer do SDD) |
