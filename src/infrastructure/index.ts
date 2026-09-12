import { buildApp } from "./server.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);

app.listen({ host: config.host, port: config.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
