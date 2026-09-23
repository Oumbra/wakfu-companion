import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_STORAGE_CEILING_MB,
  MAX_HISTORY_BYTES_PER_ACCOUNT,
  exceedsStorageBudget,
  storageCeilingBytes,
} from './storage';

describe('budget de stockage de l’historique', () => {
  it('refuse seulement ce qui ferait dépasser le budget du compte', () => {
    expect(exceedsStorageBudget(0, MAX_HISTORY_BYTES_PER_ACCOUNT)).toBe(false);
    expect(exceedsStorageBudget(1, MAX_HISTORY_BYTES_PER_ACCOUNT)).toBe(true);
    expect(exceedsStorageBudget(MAX_HISTORY_BYTES_PER_ACCOUNT, 0)).toBe(false);
  });

  it('lit le plafond global dans l’environnement, défaut sinon', () => {
    expect(storageCeilingBytes('100')).toBe(100 * 1024 * 1024);
    for (const raw of [undefined, '', 'abc', '-5']) {
      expect(storageCeilingBytes(raw)).toBe(DEFAULT_HISTORY_STORAGE_CEILING_MB * 1024 * 1024);
    }
  });
});
