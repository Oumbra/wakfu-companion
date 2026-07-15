import { Injectable } from '@angular/core';

const DB_NAME = 'wakfu-companion';
const DB_VERSION = 1;
const HANDLE_STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persistance locale : IndexedDB pour le FileSystemFileHandle (seul support
 * capable de mémoriser un handle natif via structured clone), localStorage
 * pour les préférences simples (watchlist d'ennemis, filtres...).
 */
@Injectable({ providedIn: 'root' })
export class PersistenceService {
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
