import type pg from "pg";
import type { AskInvestigationQuestion } from "../ports/investigation-questions.js";

/** Stores a user question in the case history. It never pretends to run an agent. */
export class PostgresInvestigationQuestions {
  constructor(private readonly pool: pg.Pool) {}

  async ask(input: Parameters<AskInvestigationQuestion>[0]): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const investigation = await client.query<{ id: string }>(
        "SELECT id FROM investigations WHERE id = $1 FOR UPDATE",
        [input.investigationId],
      );
      if (!investigation.rows[0]) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO investigation_events (investigation_id, type, actor, message, payload)
         VALUES ($1, 'investigation.question_asked', 'User', 'Question added to the investigation.', $2::jsonb)`,
        [input.investigationId, JSON.stringify({ question: input.question })],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
