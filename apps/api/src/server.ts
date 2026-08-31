import cors from "@fastify/cors";
import dotenv from "dotenv";
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";

dotenv.config({ path: "../../.env" });
dotenv.config();

const port = Number(process.env.API_PORT ?? 5174);
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
registerRoutes(app);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
