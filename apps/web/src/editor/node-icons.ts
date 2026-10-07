import {
  Bot,
  Brain,
  CircleHelp,
  Code,
  Database,
  DatabaseZap,
  GitBranch,
  Globe,
  Hourglass,
  Layers,
  LogIn,
  Merge,
  MessageSquare,
  PenLine,
  Play,
  PlugZap,
  Repeat,
  Reply,
  Siren,
  Split,
  Variable,
  Webhook,
  Workflow,
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
  // Spec 010.
  'plug-zap': PlugZap,
  // Spec 015: nó marcador de nó importado sem suporte.
  'circle-help': CircleHelp,
  // Spec 008.
  hourglass: Hourglass,
  'log-in': LogIn,
  workflow: Workflow,
  // Spec 011.
  bot: Bot,
  brain: Brain,
  'database-zap': DatabaseZap,
  'message-square': MessageSquare,
};

/** Ícones conhecidos (o teste garante que todo nó da plataforma tenha o seu). */
export const KNOWN_ICONS = Object.keys(NODE_ICONS);
