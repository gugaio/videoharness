import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { Investigation } from "../domain/investigation.js";
import type { InvestigationQueryRepository } from "../ports/investigation-query.js";

export type InvestigationQueries = {
  getInvestigation(id: string): Promise<Investigation | null>;
  listEventsAfter(investigationId: string, afterEventId: string): Promise<InvestigationEvent[]>;
};

export function createInvestigationQueries(repository: InvestigationQueryRepository): InvestigationQueries {
  return {
    getInvestigation: (id) => repository.findById(id),
    listEventsAfter: (investigationId, afterEventId) =>
      repository.listEventsAfter(investigationId, afterEventId, 200),
  };
}
