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
  await db.sessions.put({
    id: SESSION_ID,
    meta,
    session,
    split,
    tiled,
    finalization: null,
    finalZip: null,
  });
}

export async function saveSplit(split: SplitData, meta: SessionMeta): Promise<void> {
  const existing = await db.sessions.get(SESSION_ID);
  await db.sessions.put({
    id: SESSION_ID,
    meta,
    session: existing?.session ?? null,
    split,
    tiled: null,
    finalization: null,
    finalZip: null,
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
    finalization: existing?.finalization?.oldFoldersDeleted
      ? { ...existing.finalization, finalizedAt: 0 }
      : null,
    finalZip: null,
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

export async function updateSessionStage(stage: SessionMeta["stage"]): Promise<void> {
  await db.transaction("rw", db.sessions, async () => {
    const record = await db.sessions.get(SESSION_ID);
    if (!record) throw new Error("No saved session found.");
    await db.sessions.put({ ...record, meta: { ...record.meta, stage, updatedAt: Date.now() } });
  });
}

/** Free stored full-resolution inputs; keep tiled data, metadata and the final ZIP. */
export async function cleanupIntermediateData(finalization: FinalizationState): Promise<SessionRecord> {
  return db.transaction("rw", db.sessions, async () => {
    const record = await db.sessions.get(SESSION_ID);
    if (!record?.session || !record.tiled) {
      throw new Error("No complete tiled session is available for cleanup.");
    }
    const cleaned: SessionRecord = {
      ...record,
      session: { ...record.session, pairs: [] },
      split: null,
      finalization,
      meta: { ...record.meta, updatedAt: Date.now() },
    };
    await db.sessions.put(cleaned);
    return cleaned;
  });
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
