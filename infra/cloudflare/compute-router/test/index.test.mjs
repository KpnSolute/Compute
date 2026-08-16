import assert from "node:assert/strict";
import test from "node:test";

import { proxyRequest, resolveRoute } from "../src/index.mjs";

test("maps the product, unified API, and compatibility hosts", () => {
  assert.deepEqual(resolveRoute("https://compute.kpnsolute.com/mjcc?preview=1"), {
    kind: "product",
    service: "compute",
    upstreamOrigin: "https://kpncompute.onrender.com",
    upstreamPath: "/mjcc?preview=1",
    publicPathPrefix: "",
  });
  assert.deepEqual(resolveRoute("https://api.kpnsolute.com/compute/api/v1/workspaces"), {
    kind: "api-gateway",
    service: "compute",
    upstreamOrigin: "https://mjcc-managements.onrender.com",
    upstreamPath: "/api/v1/workspaces",
    publicPathPrefix: "/compute",
  });
  assert.deepEqual(resolveRoute("https://api.compute.kpnsolute.com/api/auth/me"), {
    kind: "api-compatibility",
    service: "compute",
    upstreamOrigin: "https://mjcc-managements.onrender.com",
    upstreamPath: "/api/auth/me",
    publicPathPrefix: "",
  });
});

test("preserves method, path, query, body, and public origin", async () => {
  let capturedRequest;
  let capturedInit;
  const fetchImpl = async (request, init) => {
    capturedRequest = request;
    capturedInit = init;
    return new Response("created", {
      status: 201,
      headers: { location: "https://mjcc-managements.onrender.com/api/v1/jobs/42" },
    });
  };

  const response = await proxyRequest(
    new Request("https://api.kpnsolute.com/compute/api/v1/jobs?dry_run=1", {
      method: "POST",
      headers: { origin: "https://compute.kpnsolute.com" },
      body: "payload",
    }),
    fetchImpl,
  );

  assert.equal(capturedRequest.url, "https://mjcc-managements.onrender.com/api/v1/jobs?dry_run=1");
  assert.equal(capturedRequest.method, "POST");
  assert.equal(await capturedRequest.text(), "payload");
  assert.equal(capturedRequest.headers.get("origin"), "https://compute.kpnsolute.com");
  assert.equal(capturedRequest.headers.get("x-forwarded-host"), "api.kpnsolute.com");
  assert.deepEqual(capturedInit, { redirect: "manual" });
  assert.equal(response.status, 201);
  assert.equal(
    response.headers.get("location"),
    "https://api.kpnsolute.com/compute/api/v1/jobs/42",
  );
  assert.equal(response.headers.get("x-kpn-edge-route"), "kpnsolute-api-gateway");
});

test("rejects an unregistered service", async () => {
  const response = await proxyRequest(new Request("https://api.kpnsolute.com/scena/v1/sessions"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "route_not_found" });
});

test("returns a bounded 502 when the origin is unavailable", async () => {
  const response = await proxyRequest(
    new Request("https://compute.kpnsolute.com/mjcc"),
    async () => {
      throw new Error("connection failed");
    },
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-kpn-edge-route"), "kpnsolute-api-gateway");
  assert.equal((await response.json()).error, "origin_unavailable");
});
