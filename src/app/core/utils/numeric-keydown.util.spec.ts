import { describe, expect, it } from 'vitest';
import { resolveNumericKeyAction } from './numeric-keydown.util';

function key(k: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, ...modifiers } as KeyboardEvent;
}

describe('resolveNumericKeyAction', () => {
  it('ArrowUp/ArrowDown -> increment/decrement', () => {
    expect(resolveNumericKeyAction(key('ArrowUp'))).toBe('increment');
    expect(resolveNumericKeyAction(key('ArrowDown'))).toBe('decrement');
  });

  it('chiffres -> allow', () => {
    for (const d of '0123456789') {
      expect(resolveNumericKeyAction(key(d))).toBe('allow');
    }
  });

  it('lettre ou symbole -> block', () => {
    expect(resolveNumericKeyAction(key('e'))).toBe('block');
    expect(resolveNumericKeyAction(key('-'))).toBe('block');
    expect(resolveNumericKeyAction(key('.'))).toBe('block');
    expect(resolveNumericKeyAction(key('+'))).toBe('block');
  });

  it('touches de navigation/édition -> allow', () => {
    for (const k of [
      'Backspace',
      'Delete',
      'Tab',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Enter',
    ]) {
      expect(resolveNumericKeyAction(key(k))).toBe('allow');
    }
  });

  it('raccourcis avec modificateur (ex. Ctrl+A, Ctrl+V) -> allow même sur une lettre', () => {
    expect(resolveNumericKeyAction(key('a', { ctrlKey: true }))).toBe('allow');
    expect(resolveNumericKeyAction(key('v', { metaKey: true }))).toBe('allow');
  });

  it('touche modificatrice seule (Shift) -> allow', () => {
    expect(resolveNumericKeyAction(key('Shift'))).toBe('allow');
  });
});
