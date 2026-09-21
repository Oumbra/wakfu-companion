#!/usr/bin/env -S npx tsx
/**
 * Purges de conservation, exécutées HORS requête — le filet qui rend les durées annoncées par la
 * politique de confidentialité (§5) indépendantes du trafic.
 *
 * Toutes les purges du service sont opportunistes : elles s'exécutent à l'occasion d'un appel qui
 * touche déjà la table visée, faute de Cron Trigger sur Cloudflare Pages (voir server/README.md).
 * Tant que des joueurs se connectent, elles tournent ; dès que le trafic d'authentification se
 * tarit — nuit calme, période creuse, service à l'arrêt —, plus rien ne tourne, et un compte
 * inactif depuis plus de 12 mois survit jusqu'à ce que quelqu'un d'autre se connecte
 * (`docs/analyse-rgpd.md` 4.13, RGPD art. 5.1.e).
 *
 * Ce script appelle `runFullPurge` (server/auth/flow.ts), qui fait autorité sur les délais : les
 * comptes inactifs, les sessions mortes, les autorisations OAuth et appairages natifs expirés, et
 * les compteurs anti-abus dont la fenêtre est close. Aucun délai n'est redéfini ici.
 *
 * Idempotent et sans effet de bord : une seconde exécution ne trouve plus rien à effacer. Prévu
 * pour un appel quotidien planifié (`.github/workflows/rgpd-purges.yml`), mais s'exécute aussi
 * bien à la main :
 *
 *     npm run main:retention:purge     # production
 *     npm run dev:retention:purge      # base de développement
 */
import { createDbAuthStore } from '../auth/db-store';
import { runFullPurge } from '../auth/flow';
import { createDb } from '../db/client';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');

  const now = new Date();
  const store = createDbAuthStore(createDb(databaseUrl));
  const report = await runFullPurge(store, now);

  console.log(
    `[retention-purge] ${now.toISOString()} — ` +
      `${report.inactiveAccounts} compte(s) inactif(s) effacé(s), ` +
      `${report.deadSessions} session(s) morte(s) effacée(s), ` +
      `autorisations OAuth, appairages expirés et compteurs anti-abus nettoyés.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
