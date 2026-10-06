# ADR-0005 — Autenticação via OIDC federado ao diretório institucional

**Status:** Proposta — **depende de informação da instituição**

- **Decisão proposta:** a aplicação fala apenas **OIDC**. Se a instituição já tiver um IdP (Entra ID/Azure AD, ADFS, Keycloak), integrar direto; caso contrário, subir **Keycloak** federado ao AD/LDAP.
- Instituição tem Entra ID/Azure AD
- **Atualização (06/10/2026, decisão do PO):** o OIDC deixa de ser o único login. A plataforma tem usuários locais (e-mail e senha) como padrão, e o login OIDC passa a ser opcional, desativado por padrão ([spec 014](../../specs/014-primeiro-usuario/spec.md); NFR-G03 atualizada). Quando ativado, vale o que esta ADR propõe.

---
Índice: [README](README.md)
