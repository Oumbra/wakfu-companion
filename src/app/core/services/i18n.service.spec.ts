import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { escapeHtml, I18nService } from './i18n.service';

describe('I18nService.tHtml — échappement des paramètres (audit sécurité)', () => {
  it('échappe les valeurs de params sans toucher au balisage de la traduction', () => {
    const i18n = TestBed.inject(I18nService);
    i18n.setLocale('fr');
    // Clé inconnue : `t()` renvoie la clé elle-même, qui sert ici de gabarit avec placeholder.
    const html = i18n.tHtml('<b>{{name}}</b>', { name: '<img src=x onerror=alert(1)>' });
    expect(html).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  });

  it('laisse `t()` inchangé (interpolation Angular classique, déjà échappée au rendu)', () => {
    const i18n = TestBed.inject(I18nService);
    expect(i18n.t('{{name}}', { name: '<i>x</i>' })).toBe('<i>x</i>');
  });

  it('échappe les cinq caractères significatifs', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
