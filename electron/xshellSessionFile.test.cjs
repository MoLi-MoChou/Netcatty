const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectXshellSessionDeepLinkUrls,
  collectXshellSessionPaths,
  isXshellSessionPath,
  parseXshellSessionText,
  parseXshellSessionFile,
} = require("./xshellSessionFile.cjs");

const SAMPLE = `[CONNECTION]
Port=59759
Protocol=SSH
Host=127.0.0.1

[CONNECTION:AUTHENTICATION]
UserName=root
Password=PCZencryptedNotUsable
`;

test("isXshellSessionPath matches .xsh files", () => {
  assert.equal(isXshellSessionPath(String.raw`C:\Users\a\Sessions\root(SSH)@1.2.3.4.xsh`), true);
  assert.equal(isXshellSessionPath("session.XSH"), true);
  assert.equal(isXshellSessionPath("readme.txt"), false);
});

test("parseXshellSessionText reads Host Port UserName and ignores Password", () => {
  const parsed = parseXshellSessionText(SAMPLE);
  assert.equal(parsed?.hostname, "127.0.0.1");
  assert.equal(parsed?.port, 59759);
  assert.equal(parsed?.username, "root");
  assert.equal(parsed?.url, "ssh://root@127.0.0.1:59759");
  assert.equal(parsed?.password, undefined);
});

test("parseXshellSessionText rejects non-SSH protocols", () => {
  assert.equal(parseXshellSessionText(`[CONNECTION]\nProtocol=TELNET\nHost=127.0.0.1\nPort=23\n`), null);
});

test("collectXshellSessionPaths finds argv session files", () => {
  const paths = collectXshellSessionPaths([
    String.raw`C:\Program Files\Netcatty\Netcatty.exe`,
    String.raw`C:\Users\suantian\AppData\Roaming\NetSarang\Xshell\Sessions\root(SSH)@172.21.17.125.xsh`,
  ]);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\.xsh$/i);
});

test("collectXshellSessionDeepLinkUrls reads a real temp file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-xsh-"));
  const filePath = path.join(dir, "root(SSH)@172.21.17.125.xsh");
  fs.writeFileSync(filePath, SAMPLE, "utf8");
  try {
    const urls = collectXshellSessionDeepLinkUrls([
      "Netcatty.exe",
      filePath,
    ]);
    assert.deepEqual(urls, ["ssh://root@127.0.0.1:59759"]);
    assert.equal(parseXshellSessionFile(filePath)?.username, "root");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
