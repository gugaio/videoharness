import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Investigation, InvestigationCapture } from "../../../domain/investigations.js";
import {
  InvestigationBudgetError,
  InvestigationIdempotencyError,
  type InvestigationRepository,
} from "../../../application/ports/investigation-repository.js";

type InvestigationRow = {
  id: string;
  inspection_id: string;
  created_at: string;
  budget_bytes: number;
  reserved_bytes: number;
  consumed_bytes: number;
};

type CaptureRow = {
  id: string;
  investigation_id: string;
  idempotency_key_hash: string;
  request_hash: string;
  status: string;
  requested_bytes: number;
  bytes_received: number | null;
  consumption_known: number;
  request_json: string;
  lens_status_json: string | null;
  evidence_json: string | null;
  created_at: string;
  updated_at: string;
  budget_reconciled: number;
};

const MAX_OWNER_BYTES = 500_000_000;
const MAX_ACTIVE_CAPTURES_PER_OWNER = 2;

export class InvestigationStore implements InvestigationRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS investigations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        inspection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        budget_bytes INTEGER NOT NULL,
        reserved_bytes INTEGER NOT NULL DEFAULT 0,
        consumed_bytes INTEGER NOT NULL DEFAULT 0,
        UNIQUE(owner_id, inspection_id)
      );
      CREATE INDEX IF NOT EXISTS investigations_owner_created
        ON investigations(owner_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS investigation_captures (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_bytes INTEGER NOT NULL,
        bytes_received INTEGER,
        consumption_known INTEGER NOT NULL DEFAULT 0,
        request_json TEXT NOT NULL,
        lens_status_json TEXT,
        evidence_json TEXT,
        budget_reconciled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, investigation_id, idempotency_key_hash)
      );
      CREATE INDEX IF NOT EXISTS investigation_captures_owner_created
        ON investigation_captures(owner_id, created_at DESC);
    `);
  }

  create(ownerId: string, investigationId: string, inspectionId: string, budgetBytes: number): Investigation {
    const existing = this.db.prepare(`
      SELECT * FROM investigations WHERE owner_id = ? AND inspection_id = ?
    `).get(ownerId, inspectionId) as InvestigationRow | undefined;
    if (existing) return toInvestigation(existing);
    this.db.prepare(`
      INSERT INTO investigations (id, owner_id, inspection_id, created_at, budget_bytes)
      VALUES (?, ?, ?, ?, ?)
    `).run(investigationId, ownerId, inspectionId, new Date().toISOString(), budgetBytes);
    return this.get(ownerId, investigationId) as Investigation;
  }

  get(ownerId: string, investigationId: string): Investigation | undefined {
    const row = this.db.prepare(`
      SELECT * FROM investigations WHERE owner_id = ? AND id = ?
    `).get(ownerId, investigationId) as InvestigationRow | undefined;
    return row ? toInvestigation(row) : undefined;
  }

  list(ownerId: string): Investigation[] {
    const rows = this.db.prepare(`
      SELECT * FROM investigations WHERE owner_id = ? ORDER BY created_at DESC
    `).all(ownerId) as InvestigationRow[];
    return rows.map(toInvestigation);
  }

  reserveCapture(
    ownerId: string,
    investigationId: string,
    captureId: string,
    idempotencyKeyHash: string,
    requestHash: string,
    requestedBytes: number,
    request: Record<string, unknown>,
  ): { capture: InvestigationCapture; created: boolean } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const investigation = this.db.prepare(`
        SELECT * FROM investigations WHERE owner_id = ? AND id = ?
      `).get(ownerId, investigationId) as InvestigationRow | undefined;
      if (!investigation) throw new Error("investigation_not_found");
      const existing = this.db.prepare(`
        SELECT * FROM investigation_captures
        WHERE owner_id = ? AND investigation_id = ? AND idempotency_key_hash = ?
      `).get(ownerId, investigationId, idempotencyKeyHash) as CaptureRow | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new InvestigationIdempotencyError();
        this.db.exec("COMMIT");
        return { capture: toCapture(existing), created: false };
      }

      const active = this.db.prepare(`
        SELECT count(*) AS count FROM investigation_captures
        WHERE owner_id = ? AND status IN ('submitting', 'queued', 'running', 'unknown')
      `).get(ownerId) as { count: number };
      if (active.count >= MAX_ACTIVE_CAPTURES_PER_OWNER) {
        throw new InvestigationBudgetError("too_many_active_captures");
      }
      const available = investigation.budget_bytes - investigation.reserved_bytes - investigation.consumed_bytes;
      if (requestedBytes > available) throw new InvestigationBudgetError();
      const ownerTotal = this.db.prepare(`
        SELECT coalesce(sum(reserved_bytes + consumed_bytes), 0) AS total
        FROM investigations WHERE owner_id = ?
      `).get(ownerId) as { total: number };
      if (requestedBytes > MAX_OWNER_BYTES - ownerTotal.total) {
        throw new InvestigationBudgetError("owner_capture_budget_exceeded");
      }

      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO investigation_captures (
          id, investigation_id, owner_id, idempotency_key_hash, request_hash,
          status, requested_bytes, request_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'submitting', ?, ?, ?, ?)
      `).run(captureId, investigationId, ownerId, idempotencyKeyHash, requestHash,
        requestedBytes, JSON.stringify(request), now, now);
      this.db.prepare(`
        UPDATE investigations SET reserved_bytes = reserved_bytes + ? WHERE id = ?
      `).run(requestedBytes, investigationId);
      const row = this.db.prepare("SELECT * FROM investigation_captures WHERE id = ?")
        .get(captureId) as CaptureRow;
      this.db.exec("COMMIT");
      return { capture: toCapture(row), created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCapture(ownerId: string, investigationId: string, captureId: string): InvestigationCapture | undefined {
    const row = this.db.prepare(`
      SELECT * FROM investigation_captures
      WHERE owner_id = ? AND investigation_id = ? AND id = ?
    `).get(ownerId, investigationId, captureId) as CaptureRow | undefined;
    return row ? toCapture(row) : undefined;
  }

  listCaptures(ownerId: string, investigationId: string): InvestigationCapture[] {
    const rows = this.db.prepare(`
      SELECT * FROM investigation_captures
      WHERE owner_id = ? AND investigation_id = ? ORDER BY created_at DESC
    `).all(ownerId, investigationId) as CaptureRow[];
    return rows.map(toCapture);
  }

  updateCapture(
    ownerId: string,
    investigationId: string,
    captureId: string,
    lensStatus: Record<string, unknown>,
  ): InvestigationCapture | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`
        SELECT * FROM investigation_captures
        WHERE owner_id = ? AND investigation_id = ? AND id = ?
      `).get(ownerId, investigationId, captureId) as CaptureRow | undefined;
      if (!row) { this.db.exec("COMMIT"); return undefined; }
      const lensState = typeof lensStatus.status === "string" ? lensStatus.status : "unknown";
      const known = lensStatus.consumption_known === true && Number.isSafeInteger(lensStatus.bytes_received);
      const bytes = known ? Number(lensStatus.bytes_received) : row.bytes_received;
      const reconcile = known && row.budget_reconciled === 0;
      let status = lensState;
      if (!known && lensState === "failed") status = "unknown";
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE investigation_captures
        SET status = ?, bytes_received = ?, consumption_known = ?, lens_status_json = ?,
            evidence_json = ?, budget_reconciled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        status,
        bytes,
        known ? 1 : 0,
        JSON.stringify(lensStatus),
        lensStatus.evidence === undefined ? row.evidence_json : JSON.stringify(lensStatus.evidence),
        reconcile ? 1 : row.budget_reconciled,
        now,
        captureId,
      );
      if (reconcile) {
        this.db.prepare(`
          UPDATE investigations SET reserved_bytes = max(0, reserved_bytes - ?),
            consumed_bytes = consumed_bytes + ? WHERE id = ?
        `).run(row.requested_bytes, bytes ?? 0, investigationId);
      }
      const updated = this.db.prepare("SELECT * FROM investigation_captures WHERE id = ?")
        .get(captureId) as CaptureRow;
      this.db.exec("COMMIT");
      return toCapture(updated);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void { this.db.close(); }
}

function toInvestigation(row: InvestigationRow): Investigation {
  return {
    id: row.id,
    inspection_id: row.inspection_id,
    created_at: row.created_at,
    budget_bytes: row.budget_bytes,
    reserved_bytes: row.reserved_bytes,
    consumed_bytes: row.consumed_bytes,
  };
}

function toCapture(row: CaptureRow): InvestigationCapture {
  return {
    id: row.id,
    investigation_id: row.investigation_id,
    idempotency_key_hash: row.idempotency_key_hash,
    request_hash: row.request_hash,
    status: row.status,
    requested_bytes: row.requested_bytes,
    bytes_received: row.bytes_received,
    consumption_known: row.consumption_known === 1,
    request: JSON.parse(row.request_json) as Record<string, unknown>,
    lens_status: row.lens_status_json ? JSON.parse(row.lens_status_json) as Record<string, unknown> : null,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) as unknown : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
