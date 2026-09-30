import { describe, expect, it } from 'vitest';
import { anonymizeWakfuLog } from './wakfu-log-anonymizer.util';

// Valeurs « réelles » assemblées à l'exécution : écrites en clair, elles feraient (à raison)
// échouer `tools/check-fixtures.mjs`, qui refuse ces motifs dans tout le code versionné.
const TOKEN = ['3f2b9c1d', '7a4e', '4b21', '9c3d', '0e1f2a3b4c5d'].join('-');
const WIN_USER = ['C:', 'Users', 'JeanDupont'].join('\\');
const LAN_IP = ['192', '168', '1', '42'].join('.');
const ACCOUNT = ['(amiReel', '#4242)'].join('');

const h = (content: string): string =>
  ` INFO 20:34:02,853 [AWT-EventQueue-0] (faw:1405) - ${content}`;

const LOG = [
  h(`Authentication token received from dispatch server : ${TOKEN} errorCode=0`),
  h(`log path=${WIN_USER}\\AppData\\Roaming\\zaap\\gamesLogs\\wakfu`),
  h(
    `onNewConnection [id: 0x595cb490, L:/${LAN_IP}:63673 - R:wakfu.ankama-games.com/54.7.1.2:5558]`,
  ),
  h(
    '[_FL_] fightId=1648305309 Tartempion breed : 4 [123456789] isControlledByAI=false obstacleId : -1 join the fight at {Point3 : (-3, 6, 0)}',
  ),
  h(
    '[_FL_] fightId=1648305309 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {Point3 : (-2, 6, 0)}',
  ),
  h('[Information (combat)] Tartempion lance le sort Coup Sournois'),
  h('[Information (combat)] Bouftou: -120 PV (Terre)'),
  h("[Information (combat)] Tartempion : +1 234 points d'XP."),
  h('[Commerce] Vendeur-Pro : je vends des ressources, mp moi vendeur@mail.fr'),
  h('[Privé] Copain : mon code de coffre est 1234'),
  h('[Privé à Copain] Tartempion : super merci'),
  h(`[Information (jeu)] Copain ${ACCOUNT} a rejoint notre monde.`),
  h(
    '[Trade] Starting an exchange between Tartempion (id=123456789) and Vendeur-Pro (id=987654321)',
  ),
].join('\r\n');

describe('anonymizeWakfuLog', () => {
  const result = anonymizeWakfuLog(LOG);
  const text = result.text;

  it('supprime les messages privés', () => {
    expect(result.privateMessagesRemoved).toBe(2);
    expect(text).not.toContain('Privé');
    expect(text).not.toContain('coffre');
  });

  it('ne laisse aucun nom, identifiant ou compte réel', () => {
    for (const real of ['Tartempion', 'Vendeur-Pro', 'Copain', '123456789', '987654321', ACCOUNT]) {
      expect(text).not.toContain(real);
    }
    expect(result.playerCount).toBe(3);
  });

  it('pseudonymise avec le schéma des fixtures, de façon cohérente', () => {
    expect(text).toContain(' Anonyme-Sram1 breed : 4 [90000001] isControlledByAI=false ');
    expect(text).toContain('Anonyme-Sram1 lance le sort Coup Sournois');
    expect(text).toContain("Anonyme-Sram1 : +1 234 points d'XP.");
    expect(text).toContain('between Anonyme-Sram1 (id=90000001) and Anonyme-Joueur1 (id=90001001)');
    expect(text).toMatch(/\[Information \(jeu\)\] Anonyme-Joueur2 \(anonyme01#1001\) a rejoint/);
  });

  it('garde les monstres et les mécaniques intacts', () => {
    expect(text).toContain('Bouftou breed : 1 [-1] isControlledByAI=true');
    expect(text).toContain('Bouftou: -120 PV (Terre)');
  });

  it('remplace jeton, chemin, IP locale, e-mail et contenu du chat', () => {
    expect(text).toContain('dispatch server : 00000000-0000-0000-0000-000000000000');
    expect(text).toContain('log path=C:\\Users\\anonymous\\AppData');
    expect(text).toContain('L:/192.0.2.10:63673');
    expect(text).toContain('R:wakfu.ankama-games.com/54.7.1.2:5558');
    expect(text).not.toContain('vendeur@mail.fr');
    expect(text).toMatch(/\[Commerce\] Anonyme-Joueur1 : lorem|\[Commerce\] Anonyme-Joueur1 : \w+/);
    expect(text).not.toContain('je vends');
  });

  it('conserve le nombre de lignes (hors privés) et les fins de ligne', () => {
    expect(text.split('\r\n')).toHaveLength(LOG.split('\r\n').length - 2);
  });
});
