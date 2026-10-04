# apps/task-runner

Processo filho que avalia expressões de usuário em isolated-vm ([ADR-0003](../../docs/adr/0003-sandbox-javascript.md), [spec 003](../../specs/003-expressoes-execucao-teste/spec.md)).

- `src/main.ts`: o processo. Um isolate por execução, com limite de memória e timeout por expressão.
- `src/client.ts` (`@olly/task-runner`): `TaskRunnerClient`, usado pela API. Inicia o processo com `fork`, reinicia com *backoff* se ele cair e não repassa variáveis de ambiente da API (segredos) ao processo.
- `src/protocol.ts`: mensagens IPC validadas com zod nos dois lados.

A spec 005 acrescenta a mensagem `runCode` (nó de código JavaScript).
