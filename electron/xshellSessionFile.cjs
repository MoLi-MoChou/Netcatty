const fs = require("node:fs");
const path = require("node:path");

const SSH_PROTOCOL = "ssh";

function parsePort(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const port = Number(String(raw).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function isXshellSessionPath(arg) {
  if (typeof arg !== "string" || !arg.trim()) return false;
  const trimmed = arg.trim().replace(/^["']|["']$/g, "");
  return /\.xsh$/i.test(trimmed);
}

function isElectronExecutableName(arg) {
  if (typeof arg !== "string") return false;
  const base = arg.replace(/^.*[/\\]/, "").toLowerCase();
  return base === "electron" || base === "electron.exe";
}

function isArgvNoise(arg, index, argv) {
  if (typeof arg !== "string") return true;
  if (index === 0) return true;
  if (arg === "." || arg === "--") return true;
  if (arg.startsWith("--")) return true;
  if (
    index === 1
    && isElectronExecutableName(argv?.[0])
    && /\.(?:js|cjs|mjs|asar)$/i.test(arg)
  ) {
    return true;
  }
  return false;
}

function collectXshellSessionPaths(argv) {
  if (!Array.isArray(argv)) return [];
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (isArgvNoise(arg, index, argv)) continue;
    if (!isXshellSessionPath(arg)) continue;
    paths.push(arg.trim().replace(/^["']|["']$/g, ""));
  }
  return paths;
}

/**
 * Minimal INI reader for Xshell .xsh session files.
 * Only keeps the last occurrence of each key within a section.
 */
function parseIniSections(text) {
  const sections = Object.create(null);
  let current = "";
  sections[current] = Object.create(null);

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1].trim();
      if (!sections[current]) sections[current] = Object.create(null);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (!key) continue;
    sections[current][key] = value;
  }
  return sections;
}

function encodeUserInfo(username) {
  if (!username) return "";
  return encodeURIComponent(username);
}

function formatHostnameForUrl(hostname) {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function toSshDeepLinkUrl({ username, hostname, port }) {
  const auth = encodeUserInfo(username);
  const host = formatHostnameForUrl(hostname);
  const portPart = port ? `:${port}` : "";
  return `ssh://${auth ? `${auth}@` : ""}${host}${portPart}`;
}

function parseXshellSessionText(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const sections = parseIniSections(text);
  const connection = sections.CONNECTION || sections.Connection || {};
  const auth = sections["CONNECTION:AUTHENTICATION"] || {};

  const protocol = String(connection.Protocol || connection.protocol || "")
    .trim()
    .toLowerCase();
  if (protocol && protocol !== SSH_PROTOCOL) {
    return null;
  }

  const hostname = String(connection.Host || connection.host || "").trim();
  if (!hostname) return null;

  const port = parsePort(connection.Port ?? connection.port);
  const username = String(auth.UserName || auth.Username || auth.userName || "")
    .trim() || undefined;

  // Xshell stores Password= encrypted; never treat it as a usable secret.
  const url = toSshDeepLinkUrl({ username, hostname, port: port || undefined });
  return {
    protocol: SSH_PROTOCOL,
    url,
    hostname,
    ...(username ? { username } : {}),
    ...(port ? { port } : {}),
  };
}

function parseXshellSessionFile(filePath, { fsModule = fs } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const resolved = filePath.trim();
  if (!isXshellSessionPath(resolved)) return null;
  try {
    if (!fsModule.existsSync(resolved)) return null;
    const text = fsModule.readFileSync(resolved, "utf8");
    return parseXshellSessionText(text);
  } catch {
    return null;
  }
}

function collectXshellSessionDeepLinkUrls(argv, options = {}) {
  const paths = collectXshellSessionPaths(argv);
  const urls = [];
  for (const filePath of paths) {
    const parsed = parseXshellSessionFile(filePath, options);
    if (parsed?.url) urls.push(parsed.url);
  }
  return urls;
}

module.exports = {
  collectXshellSessionDeepLinkUrls,
  collectXshellSessionPaths,
  isXshellSessionPath,
  parseXshellSessionFile,
  parseXshellSessionText,
};
