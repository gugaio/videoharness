import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { Investigation } from "../domain/investigation.js";

export interface InvestigationQueryRepository {
  findById(id: string): Promise<Investigation | null>;
  listEventsAfter(investigationId: string, afterEventId: string, limit: number): Promise<InvestigationEvent[]>;
}
