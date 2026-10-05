import {
  Code,
  Database,
  GitBranch,
  Globe,
  Layers,
  Merge,
  PenLine,
  Play,
  Repeat,
  Reply,
  Siren,
  Split,
  Variable,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

// O catálogo de nós usa nomes de ícones lucide; nós novos acrescentam o seu aqui.
export const NODE_ICONS: Record<string, LucideIcon> = {
  play: Play,
  'pen-line': PenLine,
  variable: Variable,
  'git-branch': GitBranch,
  globe: Globe,
  database: Database,
  code: Code,
  webhook: Webhook,
  reply: Reply,
  // Spec 007.
  merge: Merge,
  repeat: Repeat,
  layers: Layers,
  split: Split,
  siren: Siren,
};

/** Ícones conhecidos (o teste garante que todo nó da plataforma tenha o seu). */
export const KNOWN_ICONS = Object.keys(NODE_ICONS);
