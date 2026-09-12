import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { InspectionRepository } from "../../../application/ports/inspection-repository.js";
import type {
  InspectionCreated,
  InspectionDetail,
  InspectionHistoryItem,
} from "../../../domain/inspections.js";

type InspectionRow = {
  lens_inspection_id: string;
  source_url: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  snapshot_json: string | null;
};

/** Persistência do produto: a Lens continua sendo apenas a engine temporária. */
export class InspectionHistoryStore implements InspectionRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS inspections (
        lens_inspection_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        detail_json TEXT,
        snapshot_json TEXT
      );
      CREATE INDEX IF NOT EXISTS inspections_owner_created
        ON inspections(owner_id, created_at DESC);
    `);
    const columns = this.db.prepare("PRAGMA table_info(inspections)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "detail_json")) {
      this.db.exec("ALTER TABLE inspections ADD COLUMN detail_json TEXT");
    }
  }

  create(ownerId: string, sourceUrl: string, inspection: InspectionCreated): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO inspections (
        lens_inspection_id, owner_id, source_url, status, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      inspection.inspection_id,
      ownerId,
      redactSourceUrl(sourceUrl),
      inspection.status,
      now,
      now,
      inspection.expires_at,
    );
  }

  list(ownerId: string): InspectionHistoryItem[] {
    const rows = this.db.prepare(`
      SELECT lens_inspection_id, source_url, status, created_at, updated_at, expires_at, snapshot_json
      FROM inspections WHERE owner_id = ? ORDER BY created_at DESC
    `).all(ownerId) as InspectionRow[];
    return rows.map(toHistoryItem);
  }

  has(ownerId: string, inspectionId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM inspections WHERE owner_id = ? AND lens_inspection_id = ?
    `).get(ownerId, inspectionId) as { 1: number } | undefined;
    return row !== undefined;
  }

  delete(ownerId: string, inspectionId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM inspections WHERE owner_id = ? AND lens_inspection_id = ?
    `).run(ownerId, inspectionId);
    return Number(result.changes) > 0;
  }

  updateDetail(ownerId: string, inspection: InspectionDetail): void {
    this.db.prepare(`
      UPDATE inspections
      SET status = ?, updated_at = ?, expires_at = ?, detail_json = ?
      WHERE owner_id = ? AND lens_inspection_id = ?
    `).run(
      inspection.status,
      new Date().toISOString(),
      inspection.expires_at,
      JSON.stringify(inspection),
      ownerId,
      inspection.inspection_id,
    );
  }

  getDetail(ownerId: string, inspectionId: string): InspectionDetail | undefined {
    const row = this.db.prepare(`
      SELECT detail_json FROM inspections WHERE owner_id = ? AND lens_inspection_id = ?
    `).get(ownerId, inspectionId) as { detail_json: string | null } | undefined;
    if (!row?.detail_json) return undefined;
    try {
      const detail: unknown = JSON.parse(row.detail_json);
      return typeof detail === "object" && detail !== null ? detail as InspectionDetail : undefined;
    } catch {
      return undefined;
    }
  }

  getSnapshot(ownerId: string, inspectionId: string): unknown | undefined {
    const row = this.db.prepare(`
      SELECT snapshot_json FROM inspections WHERE owner_id = ? AND lens_inspection_id = ?
    `).get(ownerId, inspectionId) as { snapshot_json: string | null } | undefined;
    if (!row?.snapshot_json) return undefined;
    try {
      return JSON.parse(row.snapshot_json) as unknown;
    } catch {
      return undefined;
    }
  }

  saveSnapshot(ownerId: string, inspectionId: string, snapshot: unknown): void {
    this.db.prepare(`
      UPDATE inspections SET snapshot_json = ?, updated_at = ?
      WHERE owner_id = ? AND lens_inspection_id = ?
    `).run(JSON.stringify(snapshot), new Date().toISOString(), ownerId, inspectionId);
  }

  close(): void {
    this.db.close();
  }
}

/** URLs de manifesto podem carregar tokens de acesso em query string. */
function redactSourceUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.username = "";
    url.password = "";
    for (const key of new Set(url.searchParams.keys())) {
      url.searchParams.set(key, "REDACTED");
    }
    return url.toString();
  } catch {
    return "[URL não exibida]";
  }
}

function toHistoryItem(row: InspectionRow): InspectionHistoryItem {
  return {
    inspection_id: row.lens_inspection_id,
    source_url: row.source_url,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    snapshot_available: row.snapshot_json !== null,
  };
}
