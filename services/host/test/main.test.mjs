import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";

const { parseListenAddr, loadTotpKey, installShutdownHandlers } = await importCompiled("src/main.js");

// host:port forms that must keep working.
assert.deepEqual(parseListenAddr("127.0.0.1:8080"), { host: "127.0.0.1", port: 8080 });
assert.deepEqual(parseListenAddr("localhost:9000"), { host: "localhost", port: 9000 });
assert.deepEqual(parseListenAddr("[::1]:8080"), { host: "::1", port: 8080 });
assert.deepEqual(parseListenAddr("127.0.0.1:0"), { host: "127.0.0.1", port: 0 });

// config.ts's LOOPBACK_HOSTS/extractHost() accept these bare, portless forms
// as a valid HostConfig.listen_addr (see config.test.mjs), but they must not
// silently produce a wide-open bind here: "::1".split(":") used to yield a
// non-undefined empty-string host, which Fastify's listen() binds as "::"
// (all interfaces). parseListenAddr must reject all of these.
assert.equal(parseListenAddr("::1"), undefined);
assert.equal(parseListenAddr("[::1]"), undefined);
assert.equal(parseListenAddr("localhost"), undefined);
assert.equal(parseListenAddr("127.0.0.1"), undefined);

// Malformed and out-of-range forms must also be rejected, not crash.
assert.equal(parseListenAddr(""), undefined);
assert.equal(parseListenAddr(":8080"), undefined);
assert.equal(parseListenAddr("127.0.0.1:"), undefined);
assert.equal(parseListenAddr("127.0.0.1:70000"), undefined);
assert.equal(parseListenAddr("127.0.0.1:-1"), undefined);

{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-totp-key-"));
  await assert.rejects(() => loadTotpKey(undefined, "totp-key"), /CREDENTIALS_DIRECTORY/);
  await assert.rejects(() => loadTotpKey("", "totp-key"), /CREDENTIALS_DIRECTORY/);
  await assert.rejects(() => loadTotpKey(dir, "missing"));
  await writeFile(path.join(dir, "short"), Buffer.alloc(31));
  await assert.rejects(() => loadTotpKey(dir, "short"), /32 bytes/);
  await writeFile(path.join(dir, "long"), Buffer.alloc(33));
  await assert.rejects(() => loadTotpKey(dir, "long"), /32 bytes/);
  const expected = Buffer.alloc(32, 7);
  await writeFile(path.join(dir, "totp-key"), expected);
  assert.deepEqual(await loadTotpKey(dir, "totp-key"), expected);
}

// C4: every shutdown trigger runs the same bounded drain-then-exit path.
{
  function harness() {
    const events = {};
    const order = [];
    let exitCode;
    const shutdown = installShutdownHandlers({
      drain: async () => { order.push("drain"); },
      endPool: async () => { order.push("endPool"); },
      setNotReady: () => { order.push("setNotReady"); },
      exit: (code) => { exitCode = code; },
      log: () => {},
      register: (event, handler) => { events[event] = handler; }
    });
    return { events, order, shutdown, exitCode: () => exitCode };
  }

  // SIGTERM and SIGINT both drain (not-ready → drain → endPool) and exit 0.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    const h = harness();
    assert.equal(typeof h.events[signal], "function", `${signal} must be registered`);
    h.events[signal]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.order, ["setNotReady", "drain", "endPool"]);
    assert.equal(h.exitCode(), 0, `${signal} must exit 0`);
  }

  // An unhandled rejection and an uncaught exception drain and exit non-zero.
  for (const crash of ["unhandledRejection", "uncaughtException"]) {
    const h = harness();
    assert.equal(typeof h.events[crash], "function", `${crash} must be registered`);
    h.events[crash](new Error("boom"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.order, ["setNotReady", "drain", "endPool"]);
    assert.equal(h.exitCode(), 1, `${crash} must exit non-zero`);
  }

  // A second trigger while already shutting down is a no-op (no double drain).
  {
    const h = harness();
    await h.shutdown(0);
    await h.shutdown(1);
    assert.deepEqual(h.order, ["setNotReady", "drain", "endPool"], "shutdown must not re-run");
  }
}

console.log("main test passed.");
