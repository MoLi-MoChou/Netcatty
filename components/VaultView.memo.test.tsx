import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { vaultViewAreEqual } from "./VaultView.tsx";

const vaultViewSource = readFileSync(
  new URL("./VaultView.tsx", import.meta.url),
  "utf8",
);
const vaultViewLayoutSource = readFileSync(
  new URL("./vault/VaultViewLayout.tsx", import.meta.url),
  "utf8",
);

const baseProps = {
  hosts: [],
  keys: [],
  identities: [],
  proxyProfiles: [],
  snippets: [],
  snippetPackages: [],
  customGroups: [],
  knownHosts: [],
  sessions: [],
  managedSources: [],
  groupConfigs: {},
  terminalThemeId: "default",
  terminalFontSize: 14,
  navigateToSection: null,
};

test("VaultView re-renders when an external section navigation request changes", () => {
  assert.equal(
    vaultViewAreEqual(
      baseProps as never,
      { ...baseProps, navigateToSection: "snippets" } as never,
    ),
    false,
  );
});

test("VaultView memo does not depend on shellHistory prop identity", () => {
  assert.equal(
    vaultViewAreEqual(baseProps as never, { ...baseProps } as never),
    true,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(baseProps, "shellHistory"),
    false,
  );
});

test("VaultView re-renders when proxy profiles change", () => {
  assert.equal(
    vaultViewAreEqual(
      baseProps as never,
      {
        ...baseProps,
        proxyProfiles: [
          {
            id: "proxy-1",
            label: "Proxy",
            config: { type: "http", host: "proxy.example.com", port: 3128 },
            createdAt: 1,
          },
        ],
      } as never,
    ),
    false,
  );
});

test("VaultView re-renders when host-key verification setting changes", () => {
  assert.equal(
    vaultViewAreEqual(
      baseProps as never,
      {
        ...baseProps,
        terminalSettings: {
          verifyHostKeys: false,
        },
      } as never,
    ),
    false,
  );
});

test("notes are not VaultView props — the notes section reads notesStore", () => {
  // Note edits must not churn the App vault domain bag, so VaultView neither
  // receives notes nor compares them.
  for (const removed of [
    "notes:",
    "noteGroups:",
    "onUpdateNotes:",
    "onUpdateNoteGroups:",
  ]) {
    assert.equal(
      vaultViewSource.includes(removed),
      false,
      `VaultView must not declare ${removed}`,
    );
  }
  assert.doesNotMatch(vaultViewSource, /prev\.notes === next\.notes/);
  assert.match(
    vaultViewLayoutSource,
    /useNotesStore\(\{\s*enabled:\s*isActive,?\s*\}\)/,
  );
  assert.match(vaultViewLayoutSource, /function VaultNotesSection/);
});

test("connectionLogs are not VaultView props — the logs section reads connectionLogsStore", () => {
  for (const removed of [
    "connectionLogs:",
    "onToggleConnectionLogSaved:",
    "onDeleteConnectionLog:",
    "onClearUnsavedConnectionLogs:",
  ]) {
    assert.equal(
      vaultViewSource.includes(removed),
      false,
      `VaultView must not declare ${removed}`,
    );
  }
  // The section-gated connectionLogs memo escape hatch is gone with the prop.
  assert.equal(vaultViewSource.includes("syncVaultViewMemoSection"), false);
  assert.equal(vaultViewSource.includes("vaultViewLatestConnectionLogs"), false);
  assert.match(vaultViewLayoutSource, /useConnectionLogsStore\(\)/);
  assert.match(vaultViewLayoutSource, /function VaultConnectionLogsSection/);
});

test("notes and connectionLogs churn cannot re-render VaultView", () => {
  // Even if a caller smuggles them in, areEqual ignores both.
  assert.equal(
    vaultViewAreEqual(
      { ...baseProps, notes: [], connectionLogs: [] } as never,
      {
        ...baseProps,
        notes: [{ id: "n1" }],
        connectionLogs: [{ id: "log-1" }],
      } as never,
    ),
    true,
  );
});

test("VaultView re-renders when terminalHosts identity changes", () => {
  const hosts = [{ id: "saved" }];
  assert.equal(
    vaultViewAreEqual(
      { ...baseProps, hosts, terminalHosts: hosts } as never,
      { ...baseProps, hosts, terminalHosts: [...hosts, { id: "ephemeral-1", ephemeral: true }] } as never,
    ),
    false,
  );
});

test("VaultView re-renders when a connected SSH session appears for the PF picker", () => {
  assert.equal(
    vaultViewAreEqual(
      { ...baseProps, sessions: [] } as never,
      {
        ...baseProps,
        sessions: [{
          id: "s-xsh",
          hostId: "ephemeral-xsh",
          status: "connected",
          hostname: "127.0.0.1",
          username: "root",
          port: 2222,
          protocol: "ssh",
        }],
      } as never,
    ),
    false,
  );
});

test("VaultView ignores session title/cwd churn that does not affect the PF picker", () => {
  const session = {
    id: "s1",
    hostId: "a",
    status: "connected" as const,
    hostname: "a.example.test",
    username: "alice",
    port: 22,
    protocol: "ssh" as const,
  };
  assert.equal(
    vaultViewAreEqual(
      { ...baseProps, sessions: [{ ...session, title: "old" }] } as never,
      { ...baseProps, sessions: [{ ...session, title: "new", cwd: "/tmp" }] } as never,
    ),
    true,
  );
});

