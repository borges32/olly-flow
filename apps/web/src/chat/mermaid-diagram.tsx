import { AlertTriangle, Loader2, Workflow } from 'lucide-react';
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
      <div className="my-3 flex items-center gap-2 rounded-lg border border-dashed border-current/20 px-3 py-6 text-xs opacity-70">
        <Loader2 className="size-3 animate-spin" /> Desenhando o diagrama…
      </div>
    );
  }
  if ('error' in result) {
    return (
      <div
        className="my-3 grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
        data-testid="mermaid-error"
      >
        <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            <span className="font-medium">Não foi possível desenhar o diagrama.</span>{' '}
            {result.error}
          </span>
        </p>
        <pre className="overflow-x-auto rounded-md bg-black/5 p-2 font-mono text-xs dark:bg-white/10">
          {code}
        </pre>
      </div>
    );
  }
  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-current/15">
      <div
        data-testid="mermaid-diagram"
        className="overflow-x-auto bg-white p-4 dark:bg-zinc-900 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        // SVG gerado pela biblioteca com `securityLevel: 'strict'` (sanitizado por ela).
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
      <figcaption className="flex items-center gap-1.5 border-t border-current/10 bg-current/5 px-3 py-1.5 text-[11px] opacity-70">
        <Workflow className="size-3" /> Diagrama
      </figcaption>
    </figure>
  );
}
