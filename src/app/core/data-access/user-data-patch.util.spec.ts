import { buildUserDataPatch } from './user-data-patch.util';

describe('buildUserDataPatch', () => {
  describe('clé non fusionnable', () => {
    it('renvoie toujours la valeur entière', () => {
      expect(buildUserDataPatch('watchlist', [1], [1, 2])).toEqual({ kind: 'full' });
      expect(buildUserDataPatch('dashboardLayout', 'a', 'a')).toEqual({ kind: 'full' });
    });
  });

  describe('profile', () => {
    const acked = {
      pseudo: 'Oumbra',
      avatarIndex: 3,
      soundItems: [{ name: 'Pierre', enabled: true }],
      alertDurationSeconds: 3.5,
      alertManualClose: false,
    };

    it('ne retient que les champs modifiés (le pseudo et l’avatar ne voyagent pas)', () => {
      const local = { ...acked, alertManualClose: true, alertDurationSeconds: 2 };
      expect(buildUserDataPatch('profile', acked, local)).toEqual({
        kind: 'patch',
        patch: { alertManualClose: true, alertDurationSeconds: 2 },
      });
    });

    it('inclut un champ nouveau côté local', () => {
      const local = { ...acked, avatarExternalUrl: 'https://x/y.png' };
      expect(buildUserDataPatch('profile', acked, local)).toEqual({
        kind: 'patch',
        patch: { avatarExternalUrl: 'https://x/y.png' },
      });
    });

    it('compare les listes par contenu, pas par référence', () => {
      const local = { ...acked, soundItems: [{ name: 'Pierre', enabled: true }] };
      expect(buildUserDataPatch('profile', acked, local)).toEqual({ kind: 'none' });
    });

    it('signale « rien » quand tout est identique', () => {
      expect(buildUserDataPatch('profile', acked, { ...acked })).toEqual({ kind: 'none' });
    });

    it('retombe sur la valeur entière si un champ a disparu localement', () => {
      const { avatarIndex: _dropped, ...local } = acked;
      expect(buildUserDataPatch('profile', acked, local)).toEqual({ kind: 'full' });
    });

    it('traite un champ local `undefined` comme absent (il ne serait pas sérialisé)', () => {
      const local = { ...acked, avatarIndex: undefined };
      expect(buildUserDataPatch('profile', acked, local)).toEqual({ kind: 'full' });
    });

    it('retombe sur la valeur entière si l’une des deux formes n’est pas un objet', () => {
      expect(buildUserDataPatch('profile', null, acked)).toEqual({ kind: 'full' });
      expect(buildUserDataPatch('profile', acked, [1])).toEqual({ kind: 'full' });
    });
  });

  describe('roster', () => {
    const acked = [
      { id: 'main', label: '', isDefault: true, characters: [{ name: 'A' }] },
      { id: 'alt', label: 'Alt', characters: [], gameServer: 'pandora' },
    ];

    it('n’envoie que le compte touché, avec ses seuls champs modifiés', () => {
      const local = [acked[0], { ...acked[1], gameServer: 'rubilax' }];
      expect(buildUserDataPatch('roster', acked, local)).toEqual({
        kind: 'patch',
        patch: { accounts: [{ id: 'alt', gameServer: 'rubilax' }] },
      });
    });

    it('envoie un compte nouveau en entier', () => {
      const added = { id: 'new', label: 'Nouveau', characters: [] };
      expect(buildUserDataPatch('roster', acked, [...acked, added])).toEqual({
        kind: 'patch',
        patch: { accounts: [added] },
      });
    });

    it('exprime une suppression de compte par removedIds', () => {
      expect(buildUserDataPatch('roster', acked, [acked[0]])).toEqual({
        kind: 'patch',
        patch: { removedIds: ['alt'] },
      });
    });

    it('combine modification, ajout et suppression', () => {
      const local = [
        { ...acked[0], characters: [{ name: 'A' }, { name: 'B' }] },
        { id: 'new', label: 'N', characters: [] },
      ];
      expect(buildUserDataPatch('roster', acked, local)).toEqual({
        kind: 'patch',
        patch: {
          accounts: [
            { id: 'main', characters: [{ name: 'A' }, { name: 'B' }] },
            { id: 'new', label: 'N', characters: [] },
          ],
          removedIds: ['alt'],
        },
      });
    });

    it('signale « rien » quand tout est identique', () => {
      expect(
        buildUserDataPatch(
          'roster',
          acked,
          acked.map((a) => ({ ...a })),
        ),
      ).toEqual({
        kind: 'none',
      });
    });

    it('retombe sur la valeur entière si un champ d’un compte a disparu', () => {
      const { gameServer: _dropped, ...alt } = acked[1];
      expect(buildUserDataPatch('roster', acked, [acked[0], alt])).toEqual({ kind: 'full' });
    });

    it('retombe sur la valeur entière si l’ordre des comptes existants change', () => {
      expect(buildUserDataPatch('roster', acked, [acked[1], acked[0]])).toEqual({ kind: 'full' });
    });

    it('retombe sur la valeur entière sur un id manquant ou en double', () => {
      expect(buildUserDataPatch('roster', acked, [acked[0], { label: 'x' }])).toEqual({
        kind: 'full',
      });
      expect(buildUserDataPatch('roster', acked, [acked[0], acked[0]])).toEqual({ kind: 'full' });
    });
  });
});
