// 记忆存储：IndexedDB（独立于 Gemini 页面数据，仅本机保存）
import type { Memory, NewMemory } from '../types';

const DB_NAME = 'GeminiPP';
const DB_VERSION = 1;
const STORE_NAME = 'memories';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('syncId', 'syncId', { unique: true });
        store.createIndex('pinned', 'pinned');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getAllRecords(): Promise<Memory[]> {
  return openDb().then((db) => new Promise<Memory[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as Memory[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  }));
}

export async function getAllMemories(): Promise<Memory[]> {
  const records = await getAllRecords();
  return records.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function getMemoriesForInjection(): Promise<Memory[]> {
  return getAllMemories();
}

export async function saveMemory(memory: NewMemory): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();
    const record: Memory = {
      ...memory,
      syncId: memory.syncId ?? crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    };
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => reject(tx.error);
  });
}

export async function updateMemory(id: number, patch: Partial<NewMemory>): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as Memory | undefined;
      if (!existing) { reject(new Error(`Memory ${id} not found`)); return; }
      const next: Memory = { ...existing, ...patch, id, updatedAt: Date.now() };
      store.put(next);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteMemory(id: number): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => reject(tx.error);
  });
}

export async function touchMemories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as Memory | undefined;
        if (existing) {
          store.put({ ...existing, accessCount: existing.accessCount + 1, lastAccessedAt: Date.now() });
        }
      };
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => reject(tx.error);
  });
}
