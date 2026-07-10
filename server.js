const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { existsSync } = require("node:fs");
const path = require("node:path");
const PORT = Number(process.env.ELO_SERVER_PORT || 8787);
const PYTHON_CANDIDATES = [
  process.env.PYTHON_BIN,
  "/Users/marcel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  "python3",
].filter(Boolean);
const PYTHON_BIN = PYTHON_CANDIDATES.find((candidate) => candidate === "python3" || existsSync(candidate)) || "python3";
const BRIDGE_SCRIPT = path.join(__dirname, "scripts", "kitakana_elo_bridge.py");

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function runBridge(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [BRIDGE_SCRIPT], {
      cwd: __dirname,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Elo bridge exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout || "{}");
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Could not parse Elo bridge response: ${stdout || stderr || error.message}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/elo/status") {
      const result = await runBridge({ op: "status" });
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/elo/context") {
      const result = await runBridge({
        op: "context",
        teamA: url.searchParams.get("teamA") || "",
        teamB: url.searchParams.get("teamB") || "",
      });
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/elo/submit-match") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await runBridge({ op: "submit", ...body });
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/elo/sync-matches") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await runBridge({ op: "batch", ...body });
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
}

createServer(handle).listen(PORT, "127.0.0.1", () => {
  console.log(`Kitakana Elo bridge listening at http://127.0.0.1:${PORT}`);
  console.log(`Python: ${PYTHON_BIN}`);
});
