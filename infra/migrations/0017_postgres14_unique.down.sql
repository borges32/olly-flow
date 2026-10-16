-- Sem volta: o formato anterior (`UNIQUE NULLS NOT DISTINCT`) exige PostgreSQL 15, e os índices
-- parciais têm o mesmo efeito. Os índices continuam (as migrations 0009 e 0010 também os criam).
SELECT 1;
