// Purpose: Empty-string passwords must still attach, and live terminal reuse
// must ignore endpoint/auth fingerprints (one-shot ssh:// / .xsh sessions).

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const {
  attachPortForwardConnectPassword,
  resolvePortForwardReuseTransport,
} = require("./portForwardingBridge.cjs");
const { isPasswordProvided } = require("./sshAuthHelper.cjs");

test("should attach empty-string password for one-shot / bastion SSH", () => {
  assert.equal(isPasswordProvided(""), true);
  assert.equal(isPasswordProvided(undefined), false);
  assert.deepEqual(attachPortForwardConnectPassword({}, ""), { password: "" });
  assert.deepEqual(attachPortForwardConnectPassword({}, undefined), {});
  assert.deepEqual(attachPortForwardConnectPassword({}, "secret"), { password: "secret" });
});

test("live source session reuse ignores a mismatched endpoint fingerprint", () => {
  const conn = { _sock: { destroyed: false } };
  const connRef = { conn, state: "live", endpoint: { hostname: "live.example.test" } };
  const sessions = new Map([
    ["term-session-1", {
      conn,
      stream: {},
      connRef,
    }],
  ]);

  const reused = resolvePortForwardReuseTransport({
    sessions,
    sourceSessionId: "term-session-1",
    reuseEndpoint: {
      hostname: "127.0.0.1",
      port: 9,
      username: "nobody",
      authFingerprint: "mismatch",
    },
  });
  assert.equal(reused, connRef);
});

test("port-forward start path reuses a live session without passing endpoint", () => {
  const source = readFileSync(require.resolve("./portForwardingBridge.cjs"), "utf8");
  assert.match(
    source,
    /resolveTransportForReuse\(\{\s*sessions: sessionMap,\s*sourceSessionId,\s*kind: "channel",\s*\}\)/,
  );
  assert.match(source, /isPasswordProvided\(password\)/);
});
