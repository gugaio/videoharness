import { afterEach, describe, expect, it } from "vitest";
import { InvestigationBudgetError, InvestigationIdempotencyError } from "../../../application/ports/investigation-repository.js";
import { InvestigationStore } from "./investigation-store.js";

const stores: InvestigationStore[] = [];
function store() {
  const value = new InvestigationStore(":memory:");
  stores.push(value);
  return value;
}

afterEach(() => { for (const value of stores.splice(0)) value.close(); });

describe("InvestigationStore", () => {
  it("reserves budget transactionally and reconciles only once with actual bytes", () => {
    const repository = store();
    const investigation = repository.create("owner-a", "inv-a", "inspection-a", 20_000);
    expect(investigation).toMatchObject({ reserved_bytes: 0, consumed_bytes: 0 });

    const reservation = repository.reserveCapture(
      "owner-a", "inv-a", "capture-a", "key-hash", "request-hash", 10_000,
      { selection: { segment_refs: ["seg"] } },
    );
    expect(reservation.created).toBe(true);
    expect(repository.get("owner-a", "inv-a")).toMatchObject({ reserved_bytes: 10_000, consumed_bytes: 0 });

    const duplicate = repository.reserveCapture(
      "owner-a", "inv-a", "capture-b", "key-hash", "request-hash", 10_000,
      { selection: { segment_refs: ["seg"] } },
    );
    expect(duplicate.created).toBe(false);
    expect(duplicate.capture.id).toBe("capture-a");

    repository.updateCapture("owner-a", "inv-a", "capture-a", {
      status: "completed", bytes_received: 2_500, consumption_known: true,
    });
    repository.updateCapture("owner-a", "inv-a", "capture-a", {
      status: "completed", bytes_received: 2_500, consumption_known: true,
    });
    expect(repository.get("owner-a", "inv-a")).toMatchObject({ reserved_bytes: 0, consumed_bytes: 2_500 });
  });

  it("rejects changed retries, over-budget requests, and cross-owner reads", () => {
    const repository = store();
    repository.create("owner-a", "inv-a", "inspection-a", 5_000);
    repository.reserveCapture("owner-a", "inv-a", "capture-a", "key", "request-a", 4_000, {});

    expect(() => repository.reserveCapture("owner-a", "inv-a", "capture-b", "key", "request-b", 1_000, {}))
      .toThrow(InvestigationIdempotencyError);
    expect(() => repository.reserveCapture("owner-a", "inv-a", "capture-c", "key-2", "request-c", 2_000, {}))
      .toThrow(InvestigationBudgetError);
    expect(repository.get("owner-b", "inv-a")).toBeUndefined();
    expect(repository.getCapture("owner-b", "inv-a", "capture-a")).toBeUndefined();
  });

  it("keeps reservations when the engine cannot confirm consumption", () => {
    const repository = store();
    repository.create("owner-a", "inv-a", "inspection-a", 10_000);
    repository.reserveCapture("owner-a", "inv-a", "capture-a", "key", "request", 8_000, {});
    repository.updateCapture("owner-a", "inv-a", "capture-a", {
      status: "failed", error: "job_lost", consumption_known: false,
    });
    expect(repository.get("owner-a", "inv-a")).toMatchObject({ reserved_bytes: 8_000, consumed_bytes: 0 });
  });
});
