"use strict";

const http = require("http");
const { handleHealthMinistryRequest } = require("./health-ministry-api");

const originalCreateServer = http.createServer;

http.createServer = function patchedCreateServer(optionsOrListener, maybeListener) {
  const hasOptions = typeof optionsOrListener !== "function";
  const options = hasOptions ? optionsOrListener : undefined;
  const listener = hasOptions ? maybeListener : optionsOrListener;

  if (typeof listener !== "function") return originalCreateServer.apply(http, arguments);

  const wrappedListener = (req, res) => {
    Promise.resolve(handleHealthMinistryRequest(req, res))
      .then((handled) => {
        if (!handled && !res.writableEnded) listener(req, res);
      })
      .catch((error) => {
        console.error("Health Ministry wrapper error", error);
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: "server_error", message: "שגיאת שרת" }));
      });
  };

  return hasOptions
    ? originalCreateServer.call(http, options, wrappedListener)
    : originalCreateServer.call(http, wrappedListener);
};

require("./server.js");
