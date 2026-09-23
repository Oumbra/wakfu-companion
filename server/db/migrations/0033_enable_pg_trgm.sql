-- Extension trigramme pour les index GIN de la recherche catalogue (ILIKE '%q%' sur les noms
-- d'objets et de monstres, functions/api/v1/catalog/search.ts) — index créés par la 0034.
-- Disponible sur Neon sans privilège superutilisateur.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
