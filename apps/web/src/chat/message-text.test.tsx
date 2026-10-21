import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageText } from './chat-view';

/** Trecho da resposta real de produção do PO (SC-006). */
const report = `**Registro:** P-26103445 · **Escopo:** \`Cassandra\`

## 6. Ações recomendadas
| Prioridade | Ação | Tipo |
|---|---|---|
| Imediata | Ajustar \`requests.memory\` para **3,1 GiB** | Correção |
| Curto prazo | Avaliar aumento de réplicas | Mitigação |

---

### Quer aprofundar?

1. 📜 **Logs de erro** — ~~antigo~~ https://exemplo.com.br
`;

describe('spec 028 — FR-012: Markdown GFM nas respostas do chat', () => {
  it('FR-012/SC-006: a tabela vira <table> com cabeçalho e linhas, dentro de um contêiner com rolagem', () => {
    const html = renderToStaticMarkup(<MessageText text={report} />);
    expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"><table/);
    expect(html).toContain('<th');
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html).toContain('<strong>3,1 GiB</strong>');
    expect(html).not.toContain('|---|');
  });

  it('FR-012: títulos, linha horizontal, tachado e link automático', () => {
    const html = renderToStaticMarkup(<MessageText text={report} />);
    expect(html).toMatch(/<h2 class="[^"]+">6. Ações recomendadas<\/h2>/);
    expect(html).toMatch(/<h3 class="[^"]+">Quer aprofundar\?<\/h3>/);
    expect(html).toContain('<hr');
    expect(html).toContain('<del>antigo</del>');
    expect(html).toContain('href="https://exemplo.com.br"');
  });

  it('FR-012: continua sem HTML bruto', () => {
    const html = renderToStaticMarkup(<MessageText text={'<script>alert(1)</script> <b>x</b>'} />);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
  });
});
