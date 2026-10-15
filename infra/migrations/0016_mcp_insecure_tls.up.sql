-- Spec 010 (Histórico 14/10/2026): opção do servidor MCP de não verificar o certificado TLS
-- (ex.: CA interna). Padrão: verifica.
ALTER TABLE mcp_servers ADD COLUMN insecure_tls BOOLEAN NOT NULL DEFAULT false;
