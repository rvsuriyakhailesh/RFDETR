import Dexie, { type Table } from "dexie";
import type { ValidatedSession, SessionMeta, SplitData, TiledData, FinalizationState } from "./types";

export interface SessionRecord {
  id: string;
  meta: SessionMeta;
  session: ValidatedSession | null;
  split: SplitData | null;
  tiled: TiledData | null;
  finalization: FinalizationState | null;
  finalZip: Blob | null;
}

const DB_NAME = "rfdetr-pipeline";
const DB_VERSION = 1;
const SESSION_ID = "current";

class PipelineDB extends Dexie {
  sessions!: Table<SessionRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      sessions: "id",
    });
  }
}

export const db = new PipelineDB();

export async function loadSession(): Promise<SessionRecord | undefined> {
  return db.sessions.get(SESSION_ID);
}

export async function saveSession(
  meta: SessionMeta,
  session: ValidatedSession | null,
  split: SplitData | null = null,
  tiled: TiledData | null = null,
): Promise<void> {
  const existing = await db.sessions.get(SESSION_ID);
  await db.sessions.put({
    id: SESSION_ID,
    meta,
    session: session ?? existing?.session ?? null,
    split: split ?? existing?.split ?? null,
    tiled: tiled ?? existing?.tiled ?? null,
    finalization: existing?.finalization ?? null,
    finalZip: existing?.finalZip ?? null,
  });
}

export async function saveSplit(split: SplitData, meta: SessionMeta): Promise<void> {
  const existing = await db.sessions.get(SESSION_ID);
  await db.sessions.put({
    id: SESSION_ID,
    meta,
    session: existing?.session ?? null,
    split,
    tiled: existing?.tiled ?? null,
    finalization: existing?.finalization ?? null,
    finalZip: existing?.finalZip ?? null,
  });
}

export async function saveTiled(tiled: TiledData, meta: SessionMeta): Promise<void> {
  const existing = await db.sessions.get(SESSION_ID);
  await db.sessions.put({
    id: SESSION_ID,
    meta,
    session: existing?.session ?? null,
    split: existing?.split ?? null,
    tiled,
    finalization: existing?.finalization ?? null,
    finalZip: existing?.finalZip ?? null,
  });
}

export async function saveFinalization(
  finalization: FinalizationState,
  meta: SessionMeta,
  finalZip: Blob | null = null,
): Promise<void> {
  const existing = await db.sessions.get(SESSION_ID);
  await db.sessions.put({
    id: SESSION_ID,
    meta,
    session: existing?.session ?? null,
    split: existing?.split ?? null,
    tiled: existing?.tiled ?? null,
    finalization,
    finalZip: finalZip ?? existing?.finalZip ?? null,
  });
}

export async function clearSession(): Promise<void> {
  await db.sessions.delete(SESSION_ID);
}

export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return null;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    return navigator.storage.persist();
  }
  return false;
}
