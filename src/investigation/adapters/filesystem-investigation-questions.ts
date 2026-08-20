import { JsonStore } from "../../store/json-file.js";
import type { AskInvestigationQuestion } from "../ports/investigation-questions.js";

export class FilesystemInvestigationQuestions {
  constructor(private readonly store: JsonStore) {}

  async ask(input: Parameters<AskInvestigationQuestion>[0]): Promise<boolean> {
    const release = await this.store.acquireLock(`locks/investigation-${input.investigationId}`);
    try {
      const exists = await this.store.exists("investigations", input.investigationId, "investigation.json");
      if (!exists) return false;
      await this.store.appendEventUnlocked({
        aggregate: ["investigations", input.investigationId],
        event: {
          type: "investigation.question_asked",
          actor: "User",
          message: "Question added to the investigation.",
          payload: { question: input.question },
        },
      });
      return true;
    } finally {
      await release();
    }
  }
}