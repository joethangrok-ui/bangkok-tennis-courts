const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..");
const pageDir = path.join(__dirname, "..");

test("mobile stylesheet stacks the schedule instead of forcing a wide table", function () {
  const css = fs.readFileSync(path.join(pageDir, "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(pageDir, "index.html"), "utf8");
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(css, /@media \(max-width: 720px\)/);
  const mobile = css.split("@media (max-width: 720px)")[1];
  assert.match(mobile, /\.session\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.day-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.filters\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /min-width:\s*(7|8|9|1[0-9])\d{2}px/);
  assert.match(html, /id="q"/);
  assert.match(html, /for="q"/);
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, />\s*Market\s*</);
});

function startServer() {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (req, res) {
      const url = new URL(req.url, "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      if (rel.indexOf("/opportunity-day/") !== 0) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const filePath = path.normalize(path.join(repoRoot, rel));
      if (!filePath.startsWith(repoRoot)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      fs.readFile(filePath, function (err, buf) {
        if (err) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        const type = filePath.endsWith(".css") ? "text/css" :
          filePath.endsWith(".js") ? "text/javascript" :
          filePath.endsWith(".json") ? "application/json" : "text/html; charset=utf-8";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", function () {
      resolve(server);
    });
    server.on("error", reject);
  });
}

function openSocket(url) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket(url);
    const timer = setTimeout(function () { reject(new Error("websocket open timeout")); }, 8000);
    ws.addEventListener("open", function () { clearTimeout(timer); resolve(ws); });
    ws.addEventListener("error", function () { clearTimeout(timer); reject(new Error("websocket error")); });
  });
}

function cdpClient(ws) {
  let next = 0;
  const pending = new Map();
  ws.addEventListener("message", function (event) {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const handlers = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) handlers.reject(new Error(JSON.stringify(msg.error)));
    else handlers.resolve(msg.result);
  });
  return function send(method, params) {
    const id = ++next;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
}

async function readSelfTest(pageUrl, width, height) {
  const debugPort = 9400 + width;
  const profile = "/tmp/oppday-chrome-" + width + "-" + process.pid;
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn("/usr/local/bin/google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + profile,
    "--window-size=" + width + "," + height,
    "about:blank"
  ], { stdio: "ignore" });
  try {
    let version = null;
    for (let i = 0; i < 40 && !version; i += 1) {
      try {
        version = await fetch("http://127.0.0.1:" + debugPort + "/json/version").then(function (r) { return r.json(); });
      } catch (err) {
        await new Promise(function (resolve) { setTimeout(resolve, 150); });
      }
    }
    if (!version) throw new Error("Chrome DevTools port did not open");
    const target = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(pageUrl), { method: "PUT" }).then(function (r) { return r.json(); });
    const ws = await openSocket(target.webSocketDebuggerUrl);
    const send = cdpClient(ws);
    let text = "";
    for (let i = 0; i < 50 && !text; i += 1) {
      const evaluated = await send("Runtime.evaluate", {
        expression: "document.getElementById('selftest-result') ? document.getElementById('selftest-result').textContent : ''",
        returnByValue: true
      });
      text = evaluated.result && evaluated.result.value ? evaluated.result.value : "";
      if (!text) await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    ws.close();
    if (!text) throw new Error("selftest result missing at " + width);
    return JSON.parse(text);
  } finally {
    chrome.kill("SIGKILL");
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test("rendered page fits a phone and a desktop window and exercises search", async function () {
  const server = await startServer();
  const port = server.address().port;
  const url = "http://127.0.0.1:" + port + "/opportunity-day/?selftest=1&asof=2026-11-07";
  try {
    for (const size of [{ w: 390, h: 844, name: "mobile" }, { w: 1280, h: 900, name: "desktop" }]) {
      const result = await readSelfTest(url, size.w, size.h);
      assert.equal(result.ok, true, size.name + " " + JSON.stringify(result));
      assert.equal(result.overflow, false, size.name + " overflow " + result.scrollWidth + " > " + result.clientWidth);
      assert.equal(result.columnsOk, true, size.name + " columns " + result.columnCount + " at " + result.innerWidth);
      assert.equal(result.cpallHit, true);
      assert.equal(result.dialogHasBothGgcDates, true);
      assert.deepEqual(result.linkProblems, []);
    }
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});
