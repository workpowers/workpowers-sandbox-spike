import "dotenv/config";
import { betterAuth } from "better-auth";
import { pool } from "./db/client.js";

const trustedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  process.env.PUBLIC_PREVIEW_URL
].filter((origin): origin is string => Boolean(origin));

export const authConfig = {
  appName: "WorkPowers Live Fork Spike",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-dev-secret-dev-secret-dev-secret",
  database: pool,
  emailAndPassword: {
    enabled: true
  }
};

export const auth = betterAuth(authConfig);
