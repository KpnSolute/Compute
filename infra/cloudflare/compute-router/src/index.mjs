const PRODUCT_ORIGIN_BY_HOST = Object.freeze({
  "compute.kpnsolute.com": "https://kpncompute.onrender.com",
});

const API_SERVICE_REGISTRY = Object.freeze({
  compute: "https://mjcc-managements.onrender.com",
});

const API_COMPATIBILITY_ORIGIN_BY_HOST = Object.freeze({
  "api.compute.kpnsolute.com": "https://mjcc-managements.onrender.com",
});

export function resolveRoute(requestUrl) {
  const url = new URL(requestUrl);
  const hostname = url.hostname.toLowerCase();
  const productOrigin = PRODUCT_ORIGIN_BY_HOST[hostname];
  if (productOrigin) {
    return {
      kind: "product",
      service: "compute",
      upstreamOrigin: productOrigin,
      upstreamPath: url.pathname + url.search,
      publicPathPrefix: "",
    };
  }

  const compatibilityOrigin = API_COMPATIBILITY_ORIGIN_BY_HOST[hostname];
  if (compatibilityOrigin) {
    return {
      kind: "api-compatibility",
      service: "compute",
      upstreamOrigin: compatibilityOrigin,
      upstreamPath: url.pathname + url.search,
      publicPathPrefix: "",
    };
  }

  if (hostname !== "api.kpnsolute.com") return null;
  const [, service, ...pathSegments] = url.pathname.split("/");
  const upstreamOrigin = API_SERVICE_REGISTRY[service];
  if (!upstreamOrigin) return null;

  const pathname = `/${pathSegments.join("/")}`;
  return {
    kind: "api-gateway",
    service,
    upstreamOrigin,
    upstreamPath: pathname + url.search,
    publicPathPrefix: `/${service}`,
  };
}

function rewriteLocation(headers, upstreamOrigin, publicOrigin, publicPathPrefix) {
  const location = headers.get("location");
  if (!location) return;

  try {
    const resolved = new URL(location, upstreamOrigin);
    if (resolved.origin !== upstreamOrigin) return;
    const publicUrl = new URL(
      publicPathPrefix + resolved.pathname + resolved.search + resolved.hash,
      publicOrigin,
    );
    headers.set("location", publicUrl.toString());
  } catch {
    // Preserve a malformed upstream Location header rather than inventing a target.
  }
}

export async function proxyRequest(request, fetchImpl = fetch) {
  const publicUrl = new URL(request.url);
  const route = resolveRoute(publicUrl);

  if (!route) {
    return Response.json(
      { error: "route_not_found" },
      { status: 404 },
    );
  }

  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const upstreamUrl = new URL(route.upstreamPath, route.upstreamOrigin);
  const upstreamRequest = new Request(upstreamUrl, request);
  upstreamRequest.headers.set("x-forwarded-host", publicUrl.host);
  upstreamRequest.headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  upstreamRequest.headers.set("x-kpn-request-id", requestId);

  const startedAt = Date.now();

  try {
    const upstreamResponse = await fetchImpl(upstreamRequest, { redirect: "manual" });
    const responseHeaders = new Headers(upstreamResponse.headers);
    rewriteLocation(
      responseHeaders,
      route.upstreamOrigin,
      publicUrl.origin,
      route.publicPathPrefix,
    );
    responseHeaders.set("x-kpn-edge-route", "kpnsolute-api-gateway");
    responseHeaders.set("x-kpn-request-id", requestId);

    console.log(JSON.stringify({
      event: "proxy.complete",
      service: route.service,
      route_kind: route.kind,
      host: publicUrl.hostname,
      path: publicUrl.pathname,
      status: upstreamResponse.status,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
    }));

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "proxy.error",
      service: route.service,
      route_kind: route.kind,
      host: publicUrl.hostname,
      path: publicUrl.pathname,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
      error: error instanceof Error ? error.message : "unknown_error",
    }));

    return Response.json(
      { error: "origin_unavailable", request_id: requestId },
      {
        status: 502,
        headers: {
          "cache-control": "no-store",
          "x-kpn-edge-route": "kpnsolute-api-gateway",
          "x-kpn-request-id": requestId,
        },
      },
    );
  }
}

export default {
  async fetch(request) {
    return proxyRequest(request);
  },
};
