const fs = require("node:fs");
const path = require("node:path");

const SSH_PROTOCOL = "ssh";
const TELNET_PROTOCOL = "telnet";

function parsePort(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const trimmed = String(raw).trim().replace(/^"+|"+$/g, "");
  if (!trimmed) return null;
  // SecureCRT INI dword ports are often 8-digit lowercase hex (e.g. 000008ae → 2222).
  if (/^[0-9a-fA-F]{8}$/.test(trimmed)) {
    const hex = Number.parseInt(trimmed, 16);
    if (Number.isInteger(hex) && hex >= 1 && hex <= 65535) return hex;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
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

/**
 * Candidate path only — never claim every .ini as SecureCRT. Content sniff
 * happens when the file is read. We intentionally avoid registering a global
 * *.ini file association; see README.zh-CN.md / PR description.
 */
function isSecureCrtSessionPathCandidate(arg) {
  if (typeof arg !== "string" || !arg.trim()) return false;
  const trimmed = arg.trim().replace(/^["']|["']$/g, "");
  if (/\.(?:ini|xml)$/i.test(trimmed)) return true;
  // Session files under SecureCRT's Sessions tree sometimes lose an extension
  // when forwarded by bastion launchers; still require content sniff later.
  if (/[/\\]Sessions[/\\][^/\\]+$/i.test(trimmed) && !/\.[a-z0-9]+$/i.test(path.basename(trimmed))) {
    return true;
  }
  return false;
}

function collectSecureCrtSessionPaths(argv) {
  if (!Array.isArray(argv)) return [];
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (isArgvNoise(arg, index, argv)) continue;
    if (!isSecureCrtSessionPathCandidate(arg)) continue;
    paths.push(arg.trim().replace(/^["']|["']$/g, ""));
  }
  return paths;
}

function looksLikeSecureCrtIni(text) {
  return /(?:^|\n)\s*[SDB]:\s*"Hostname"\s*=/im.test(text)
    || /(?:^|\n)\s*[SDB]:\s*"Protocol Name"\s*=/im.test(text);
}

function looksLikeSecureCrtXml(text) {
  if (!/<\s*key\b/i.test(text)) return false;
  return /name\s*=\s*["']Hostname["']/i.test(text)
    && /name\s*=\s*["']Protocol Name["']/i.test(text);
}

function encodeUserInfo(username) {
  if (!username) return "";
  return encodeURIComponent(username);
}

function formatHostnameForUrl(hostname) {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function toDeepLinkUrl({ protocol, username, hostname, port }) {
  const auth = encodeUserInfo(username);
  const host = formatHostnameForUrl(hostname);
  const portPart = port ? `:${port}` : "";
  return `${protocol}://${auth ? `${auth}@` : ""}${host}${portPart}`;
}

function normalizeProtocolName(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "ssh" || value === "ssh1" || value === "ssh2" || value === "ssh-2") {
    return SSH_PROTOCOL;
  }
  if (value === "telnet") return TELNET_PROTOCOL;
  return null;
}

function sshVersionFromProtocolName(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "ssh1") return "ssh1";
  if (value === "ssh2" || value === "ssh-2" || value === "ssh") return "ssh2";
  return undefined;
}

function resolveSessionPort(session) {
  if (session.protocol === TELNET_PROTOCOL) {
    return session.port || 23;
  }
  const protocolSpecific = session.sshVersion === "ssh1"
    ? session.ssh1Port
    : session.sshVersion === "ssh2"
      ? session.ssh2Port
      : session.ssh2Port ?? session.ssh1Port;
  return (protocolSpecific ?? session.port) || 22;
}

function sessionToDeepLink(session) {
  if (!session?.hostname) return null;
  const protocol = session.protocol || SSH_PROTOCOL;
  if (protocol !== SSH_PROTOCOL && protocol !== TELNET_PROTOCOL) return null;
  const port = resolveSessionPort(session);
  const username = session.username || undefined;
  const url = toDeepLinkUrl({
    protocol,
    username,
    hostname: session.hostname,
    port: port || undefined,
  });
  return {
    protocol,
    url,
    hostname: session.hostname,
    ...(username ? { username } : {}),
    ...(port ? { port } : {}),
    ...(session.label ? { label: session.label } : {}),
  };
}

/**
 * Parse VanDyke SecureCRT session INI (Config\Sessions\*.ini).
 * Line shape: S:"Hostname"=host  /  D:"[SSH2] Port"=000008ae
 * Encrypted Password / Password V2 values are never treated as usable secrets.
 */
function parseSecureCrtIniText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  if (!looksLikeSecureCrtIni(text)) return [];

  const sessions = [];
  let current = {};

  const flush = () => {
    if (current.hostname) sessions.push(current);
    current = {};
  };

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const kv = line.match(/^[SDB]\s*:\s*"([^"]+)"\s*=\s*(.*)$/i);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim().replace(/^"+|"+$/g, "");

    if (key === "Hostname") {
      if (current.hostname) flush();
      current.hostname = value;
    } else if (key === "Username") {
      current.username = value || undefined;
    } else if (key === "Port") {
      current.port = parsePort(value) || undefined;
    } else if (key === "[SSH2] Port") {
      current.ssh2Port = parsePort(value) || undefined;
    } else if (key === "[SSH1] Port") {
      current.ssh1Port = parsePort(value) || undefined;
    } else if (key === "Protocol Name") {
      current.protocolNameRaw = value;
      current.sshVersion = sshVersionFromProtocolName(value);
      current.protocol = normalizeProtocolName(value) || undefined;
    } else if (key === "Session Name") {
      current.label = value || undefined;
    }
  }
  flush();

  return sessions
    .map((session) => {
      // Missing Protocol Name → SSH (common on older session files).
      // Explicit unsupported protocols (RDP, Serial, …) are skipped.
      if (session.protocolNameRaw && !session.protocol) return null;
      return sessionToDeepLink({
        ...session,
        protocol: session.protocol || SSH_PROTOCOL,
      });
    })
    .filter(Boolean);
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readXmlAttrName(attrs) {
  const match = String(attrs || "").match(/\bname\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!match) return "";
  return match[2] ?? match[3] ?? "";
}

/**
 * Minimal SecureCRT XML export reader (Tools → Export Settings).
 * Walks nested <key name="…"> frames; leaf frames with Hostname + SSH/Telnet
 * protocol become deep links. Passwords / identity material are ignored.
 */
function parseSecureCrtXmlText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  if (!looksLikeSecureCrtXml(text)) return [];

  const stack = [];
  const sessions = [];
  const tagRe = /<\/?\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  let match;
  let capture = null; // { kind: 'string'|'dword', name }
  let lastIndex = 0;

  const applyField = (frame, fieldName, rawValue) => {
    if (!frame || !fieldName) return;
    const value = xmlUnescape(String(rawValue || "").trim());
    if (fieldName === "Hostname") {
      frame.hostname = value;
    } else if (fieldName === "Username") {
      frame.username = value || undefined;
    } else if (fieldName === "Port") {
      frame.port = parsePort(value) || undefined;
    } else if (fieldName === "[SSH2] Port") {
      frame.ssh2Port = parsePort(value) || undefined;
    } else if (fieldName === "[SSH1] Port") {
      frame.ssh1Port = parsePort(value) || undefined;
    } else if (fieldName === "Protocol Name") {
      frame.protocolNameRaw = value;
      frame.sshVersion = sshVersionFromProtocolName(value);
      frame.protocol = normalizeProtocolName(value) || undefined;
    } else if (fieldName === "Session Name") {
      frame.label = value || undefined;
    }
  };

  const flushFrame = (frame) => {
    if (!frame?.hostname) return;
    if (frame.protocolNameRaw && !frame.protocol) return;
    const protocol = frame.protocol || SSH_PROTOCOL;
    if (protocol !== SSH_PROTOCOL && protocol !== TELNET_PROTOCOL) return;
    const label = frame.label || frame.name || undefined;
    const parsed = sessionToDeepLink({
      hostname: frame.hostname,
      username: frame.username,
      port: frame.port,
      ssh1Port: frame.ssh1Port,
      ssh2Port: frame.ssh2Port,
      sshVersion: frame.sshVersion,
      protocol,
      label,
    });
    if (parsed) sessions.push(parsed);
  };

  while ((match = tagRe.exec(text))) {
    const full = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || "";
    const isClose = full.startsWith("</");
    const isSelfClosing = /\/>\s*$/.test(full);
    const textBefore = text.slice(lastIndex, match.index);
    lastIndex = match.index + full.length;

    if (capture && !isClose) {
      // Nested start while capturing — abandon capture text.
    } else if (capture && textBefore) {
      // Keep accumulating only when we see the closing tag next.
    }

    if (!isClose && (tagName === "string" || tagName === "dword")) {
      const name = readXmlAttrName(attrs);
      if (isSelfClosing) {
        applyField(stack[stack.length - 1], name, "");
        capture = null;
      } else {
        capture = { kind: tagName, name, start: lastIndex };
      }
      continue;
    }

    if (isClose && capture && (tagName === "string" || tagName === "dword")) {
      const rawValue = text.slice(capture.start, match.index);
      applyField(stack[stack.length - 1], capture.name, rawValue);
      capture = null;
      continue;
    }

    if (!isClose && tagName === "key") {
      const name = readXmlAttrName(attrs);
      if (isSelfClosing) continue;
      stack.push({
        name,
        hostname: undefined,
        username: undefined,
        port: undefined,
        ssh1Port: undefined,
        ssh2Port: undefined,
        sshVersion: undefined,
        protocol: undefined,
        protocolNameRaw: undefined,
        label: undefined,
      });
      continue;
    }

    if (isClose && tagName === "key") {
      const frame = stack.pop();
      if (frame) flushFrame(frame);
    }
  }

  return sessions;
}

function parseSecureCrtSessionText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  if (looksLikeSecureCrtXml(text)) return parseSecureCrtXmlText(text);
  if (looksLikeSecureCrtIni(text)) return parseSecureCrtIniText(text);
  return [];
}

function parseSecureCrtSessionFile(filePath, { fsModule = fs } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) return [];
  const resolved = filePath.trim();
  if (!isSecureCrtSessionPathCandidate(resolved)) return [];
  try {
    if (!fsModule.existsSync(resolved)) return [];
    const text = fsModule.readFileSync(resolved, "utf8");
    return parseSecureCrtSessionText(text);
  } catch {
    return [];
  }
}

function collectSecureCrtSessionDeepLinks(argv, options = {}) {
  const paths = collectSecureCrtSessionPaths(argv);
  const result = { ssh: [], telnet: [] };
  for (const filePath of paths) {
    const parsed = parseSecureCrtSessionFile(filePath, options);
    for (const item of parsed) {
      if (item.protocol === TELNET_PROTOCOL) result.telnet.push(item.url);
      else if (item.protocol === SSH_PROTOCOL) result.ssh.push(item.url);
    }
  }
  return result;
}

function collectSecureCrtSessionDeepLinkUrls(argv, options = {}) {
  const { ssh, telnet } = collectSecureCrtSessionDeepLinks(argv, options);
  return [...ssh, ...telnet];
}

module.exports = {
  collectSecureCrtSessionDeepLinkUrls,
  collectSecureCrtSessionDeepLinks,
  collectSecureCrtSessionPaths,
  isSecureCrtSessionPathCandidate,
  looksLikeSecureCrtIni,
  looksLikeSecureCrtXml,
  parseSecureCrtIniText,
  parseSecureCrtSessionFile,
  parseSecureCrtSessionText,
  parseSecureCrtXmlText,
};
