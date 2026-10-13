/**
 * Thin IndexedDB wrapper. Everything a student does lives here, on their own device.
 * Schema v1 (stores are created up-front so later phases need no migration):
 *   settings  – key/value
 *   reviews   – ReviewState, keyPath "cardId"
 *   errors    – ErrorEntry,  keyPath "id", indexes "cardId", "createdAt"
 */
export const DB_NAME = "osce-trainer";
export const DB_VERSION = 1;
export type StoreName = "settings" | "reviews" | "errors";

let dbp: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot store data offline."));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      if (!db.objectStoreNames.contains("reviews")) db.createObjectStore("reviews", { keyPath: "cardId" });
      if (!db.objectStoreNames.contains("errors")) {
        const s = db.createObjectStore("errors", { keyPath: "id" });
        s.createIndex("cardId", "cardId");
        s.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close other tabs of this app and reload."));
  }).catch((e) => { dbp = null; throw e; });
  return dbp;
}

const wrap = <T>(req: IDBRequest<T>) => new Promise<T>((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  await wrap(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}

/** Run several writes atomically (one Right/Wrong = one transaction). */
export async function tx(stores: StoreName[], fn: (t: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const t = db.transaction(stores, "readwrite");
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error ?? new Error("Save was cancelled."));
    fn(t);
  });
}

export async function clearAll(): Promise<void> {
  await tx(["settings", "reviews", "errors"], (t) => {
    for (const s of ["settings", "reviews", "errors"] as const) t.objectStore(s).clear();
  });
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
