const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectSecureCrtSessionDeepLinks,
  collectSecureCrtSessionPaths,
  isSecureCrtSessionPathCandidate,
  parseSecureCrtIniText,
  parseSecureCrtSessionFile,
  parseSecureCrtXmlText,
} = require("./secureCrtSessionFile.cjs");

const SAMPLE_INI = [
  'S:"Hostname"=127.0.0.1',
  'S:"Username"=root',
  'S:"Protocol Name"=SSH2',
  'D:"[SSH2] Port"=0000e97f',
  'S:"Password V2"=encryptedNotUsable',
].join("\n");

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VanDyke>
  <key name="Sessions">
    <key name="Production">
      <key name="Gateway">
        <string name="Protocol Name">SSH2</string>
        <string name="Hostname">gateway.example.com</string>
        <dword name="[SSH2] Port">2202</dword>
        <string name="Username">deploy</string>
        <string name="Password V2">securecrt-secret-sentinel</string>
      </key>
    </key>
    <key name="Desktop">
      <string name="Protocol Name">RDP</string>
      <string name="Hostname">desktop.example.com</string>
      <dword name="Port">3389</dword>
    </key>
    <key name="Router">
      <string name="Protocol Name">Telnet</string>
      <string name="Hostname">router.example.com</string>
      <dword name="Port">23</dword>
      <string name="Username">admin</string>
    </key>
  </key>
</VanDyke>
`;

test("isSecureCrtSessionPathCandidate matches .ini/.xml candidates only", () => {
  assert.equal(isSecureCrtSessionPathCandidate(String.raw`C:\VanDyke\Config\Sessions\prod.ini`), true);
  assert.equal(isSecureCrtSessionPathCandidate("export.XML"), true);
  assert.equal(isSecureCrtSessionPathCandidate("session.xsh"), false);
  assert.equal(isSecureCrtSessionPathCandidate("readme.txt"), false);
});

test("parseSecureCrtIniText reads Hostname Port UserName and ignores Password", () => {
  const parsed = parseSecureCrtIniText(SAMPLE_INI);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].hostname, "127.0.0.1");
  assert.equal(parsed[0].port, 59775);
  assert.equal(parsed[0].username, "root");
  assert.equal(parsed[0].url, "ssh://root@127.0.0.1:59775");
  assert.equal(parsed[0].password, undefined);
});

test("parseSecureCrtIniText prefers protocol-specific hex ports", () => {
  const ssh2 = parseSecureCrtIniText([
    'S:"Hostname"=ssh2.example.com',
    'S:"Protocol Name"=SSH2',
    'D:"[SSH2] Port"=000008ae',
    'D:"[SSH1] Port"=00000017',
  ].join("\n"));
  const ssh1 = parseSecureCrtIniText([
    'S:"Hostname"=ssh1.example.com',
    'S:"Protocol Name"=SSH1',
    'D:"[SSH1] Port"=000008af',
    'D:"[SSH2] Port"=00000016',
  ].join("\n"));
  assert.equal(ssh2[0]?.port, 2222);
  assert.equal(ssh1[0]?.port, 2223);
});

test("parseSecureCrtIniText rejects unsupported protocols", () => {
  assert.deepEqual(parseSecureCrtIniText([
    'S:"Hostname"=desktop.example.com',
    'S:"Protocol Name"=RDP',
    'D:"Port"=00000d3d',
  ].join("\n")), []);
});

test("parseSecureCrtXmlText opens SSH and Telnet sessions from a batch export", () => {
  const parsed = parseSecureCrtXmlText(SAMPLE_XML);
  assert.deepEqual(
    parsed.map((item) => item.url),
    [
      "ssh://deploy@gateway.example.com:2202",
      "telnet://admin@router.example.com:23",
    ],
  );
  assert.equal(parsed.some((item) => item.hostname === "desktop.example.com"), false);
});

test("collectSecureCrtSessionPaths finds argv session files", () => {
  const paths = collectSecureCrtSessionPaths([
    String.raw`C:\Program Files\Netcatty\Netcatty.exe`,
    String.raw`C:\Users\a\AppData\Roaming\VanDyke\Config\Sessions\root@host.ini`,
    "not-a-session.txt",
  ]);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\.ini$/i);
});

test("collectSecureCrtSessionDeepLinks reads a real temp INI file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-securecrt-"));
  const filePath = path.join(dir, "root@127.0.0.1.ini");
  fs.writeFileSync(filePath, SAMPLE_INI, "utf8");
  try {
    const links = collectSecureCrtSessionDeepLinks([
      "Netcatty.exe",
      filePath,
    ]);
    assert.deepEqual(links, { ssh: ["ssh://root@127.0.0.1:59775"], telnet: [] });
    assert.equal(parseSecureCrtSessionFile(filePath)[0]?.username, "root");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("content sniff rejects ordinary INI files that only look like candidates by extension", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-securecrt-"));
  const filePath = path.join(dir, "random.ini");
  fs.writeFileSync(filePath, "[Section]\nFoo=Bar\n", "utf8");
  try {
    assert.deepEqual(parseSecureCrtSessionFile(filePath), []);
    assert.deepEqual(
      collectSecureCrtSessionDeepLinks(["Netcatty.exe", filePath]),
      { ssh: [], telnet: [] },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
