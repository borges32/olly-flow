import { Database, GitBranch, Globe, PenLine, Play, Variable, type LucideIcon } from 'lucide-react';

// O catálogo de nós usa nomes de ícones lucide; nós novos acrescentam o seu aqui.
export const NODE_ICONS: Record<string, LucideIcon> = {
  play: Play,
  'pen-line': PenLine,
  variable: Variable,
  'git-branch': GitBranch,
  globe: Globe,
  database: Database,
};

/** Ícones conhecidos (o teste garante que todo nó da plataforma tenha o seu). */
export const KNOWN_ICONS = Object.keys(NODE_ICONS);
