import { Injectable } from '@angular/core';

const DB_NAME = 'wakfu-companion';
// v2 (lot 3.1) : ajout du store CACHE_STORE (cache catalogue distant, voir
// core/api/catalog.service.ts) — onupgradeneeded ne recrée QUE les stores
// manquants, le store "handles" existant (v1) n'est pas affecté.
const DB_VERSION = 2;
const HANDLE_STORE = 'handles';
const CACHE_STORE = 'cache';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persistance locale : IndexedDB pour le FileSystemFileHandle (seul support
 * capable de mémoriser un handle natif via structured clone) et pour le
 * cache du catalogue distant (voir CACHE_STORE — objets JSON quelconques,
 * assez volumineux pour dépasser le raisonnable en localStorage, ~1 Mo pour
 * l'index catalogue), localStorage pour les préférences simples (watchlist
 * d'ennemis, filtres...).
 */
@Injectable({ providedIn: 'root' })
export class PersistenceService {
  /** Cache générique (catalogue distant, etc.) — voir CACHE_STORE. `value`
   * doit être structured-clonable (JSON simple : objets/tableaux/primitives). */
  async getCacheEntry<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const request = tx.objectStore(CACHE_STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async setCacheEntry(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getFileHandle(key: string): Promise<FileSystemFileHandle | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const request = tx.objectStore(HANDLE_STORE).get(key);
      request.onsuccess = () => resolve(request.result as FileSystemFileHandle | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async setFileHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearFileHandle(key: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  getJson<T>(key: string): T | undefined {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  setJson(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
  }
}
