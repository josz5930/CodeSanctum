import assert from "node:assert/strict";
import { compileWorkspace } from "./helpers/compile.mjs";

const { createPostgresSessionStore } = await compileWorkspace("postgres/session-store.js");

/**
 * Emulates `web_session_revocation.session_handle` → `web_session.session_handle`.
 * A bare `INSERT … VALUES` for an unknown handle is SQLSTATE 23503; a write
 * gated on the parent row is a no-op.
 */
function createFkAwareSql() {
  const issued = new Set();
  return {
    issued,
    async query(text, values) {
      if (/INSERT INTO web_session\b/i.test(text)) {
        issued.add(values[0]);
        return { rows: [] };
      }
      if (!/INSERT INTO web_session_revocation/i.test(text)) {
        return { rows: [] };
      }
      const handle = values[0];
      const gatedOnParent = /FROM web_session\b/i.test(text) || /EXISTS\s*\(/i.test(text);
      if (!gatedOnParent && !issued.has(handle)) {
        const error = new Error(
          'insert or update on table "web_session_revocation" violates foreign key constraint'
        );
        error.code = "23503";
        throw error;
      }
      return { rows: [] };
    }
  };
}

const unknown = "f".repeat(64);
const sql = createFkAwareSql();
const sessions = createPostgresSessionStore(sql);
await sessions.revoke(unknown, "logout");

console.log("Postgres session revoke guard test passed.");
