import { Loader2 } from 'lucide-react';
import type { Mermaid } from 'mermaid';
import { useEffect, useId, useState } from 'react';

/** A biblioteca só é carregada quando aparece um diagrama (fora do pacote principal). */
let loader: Promise<Mermaid> | null = null;
const loadMermaid = () => (loader ??= import('mermaid').then((m) => m.default));

/**
 * Diagrama Mermaid de uma mensagem do chat (spec 028, FR-011): desenhado no navegador com
 * `securityLevel: 'strict'` (rótulos sanitizados, sem scripts nem cliques). Sintaxe inválida:
 * mostra o código e o aviso, sem quebrar a mensagem.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [result, setResult] = useState<{ svg: string } | { error: string } | null>(null);

  useEffect(() => {
    let active = true;
    const dark = document.documentElement.classList.contains('dark');
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: dark ? 'dark' : 'default',
        });
        const { svg } = await mermaid.render(id, code);
        if (active) setResult({ svg });
      })
      .catch((error: unknown) => {
        if (active) setResult({ error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, [code, id]);

  if (!result) {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Desenhando o diagrama…
      </div>
    );
  }
  if ('error' in result) {
    return (
      <div className="my-2 grid gap-1" data-testid="mermaid-error">
        <p className="text-xs text-destructive">
          Não foi possível desenhar o diagrama: {result.error}
        </p>
        <pre className="overflow-x-auto rounded bg-black/10 p-2 font-mono text-xs dark:bg-white/10">
          {code}
        </pre>
      </div>
    );
  }
  return (
    <div
      data-testid="mermaid-diagram"
      className="my-2 overflow-x-auto rounded bg-white p-2 dark:bg-transparent [&_svg]:h-auto [&_svg]:max-w-full"
      // SVG gerado pela biblioteca com `securityLevel: 'strict'` (sanitizado por ela).
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
