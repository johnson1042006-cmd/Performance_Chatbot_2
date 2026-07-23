import { createDb, type Db } from "./connect";

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    _db = createDb().db;
  }
  return _db;
}

export const db = new Proxy({} as Db, {
  get(_target, prop: string) {
    const instance = getDb();
    return instance[prop as keyof typeof instance];
  },
});
