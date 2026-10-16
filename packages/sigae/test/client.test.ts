import { describe, expect, test, vi } from "vitest";

import {
  type SigaeClient,
  type SigaeEndpoint,
  type SigaeResponse,
  type SigaeResponseEvent,
  SigaeError,
  createSigaeClient
} from "../src/client";
import {
  BASE_URL,
  CREDENTIALS,
  allFixtures,
  hangUntilAborted,
  json,
  loadFixture,
  serializeDeep,
  testClient
} from "./helpers";

import type { ResultAsync } from "neverthrow";

const SECRETS = [CREDENTIALS.password, CREDENTIALS.user, CREDENTIALS.systemCode];

type AnyResult = ResultAsync<SigaeResponse<unknown>, SigaeError>;

async function expectError(pending: AnyResult): Promise<SigaeError> {
  const result = await pending;
  if (result.isOk()) throw new Error(`expected an error, got ${result.value.kind}`);
  expect(result.error).toBeInstanceOf(SigaeError);
  return result.error;
}

async function expectResponse<T>(pending: ResultAsync<SigaeResponse<T>, SigaeError>) {
  const result = await pending;
  if (result.isErr()) throw new Error(`expected a response, got ${result.error.message}`);
  return result.value;
}

describe("requests", () => {
  const cases: Array<{
    name: string;
    endpoint: SigaeEndpoint;
    call: (client: SigaeClient) => AnyResult;
    params: Record<string, unknown>;
  }> = [
    {
      name: "getIncidentDetails",
      endpoint: "ObtenerDetalleEmergencias",
      call: (c) => c.getIncidentDetails(1900001),
      params: { id_boleta_incidente: 1900001 }
    },
    {
      name: "getIncidentReport",
      endpoint: "ObtenerBoletaIncidente",
      call: (c) => c.getIncidentReport(1900001),
      params: { Id_Boleta_Incidente: 1900001 }
    },
    {
      name: "getDispatchedStations",
      endpoint: "ObtenerEstacionesAtiendeIncidente",
      call: (c) => c.getDispatchedStations(1900001),
      params: { Id_Boleta_Incidente: 1900001 }
    },
    {
      name: "getDispatchedUnits",
      endpoint: "ObtenerUnidadesDespachadasIncidente",
      call: (c) => c.getDispatchedUnits(1900001),
      params: { Id_Boleta_Incidente: 1900001 }
    },
    {
      name: "getLatestIncidents",
      endpoint: "ObtenerListaUltimasEmergenciasApp",
      call: (c) => c.getLatestIncidents({ count: 50 }),
      params: {
        numero_registros: 50,
        id_tipo_incidentes_despacho: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        id_tipo_incidentes_real: [1, 2, 3, 4, 5, 6, 7, 8, 9]
      }
    },
    {
      name: "getIncidentsBetween",
      endpoint: "ObtenerListaEmergenciasApp",
      call: (c) =>
        c.getIncidentsBetween({
          // 20:25 on 10 October and 23:59 on 11 October, Costa Rica time.
          from: new Date("2026-10-11T02:25:00Z"),
          to: new Date("2026-10-12T05:59:00Z")
        }),
      params: { FechaDesde: "2026-10-10", FechaHasta: "2026-10-11" }
    },
    {
      name: "getIncidentTypes",
      endpoint: "ObtenerTiposIncidente",
      call: (c) => c.getIncidentTypes(),
      params: {}
    },
    {
      name: "getProvinces",
      endpoint: "ObtenerProvinciaLista",
      call: (c) => c.getProvinces(),
      params: {}
    },
    {
      name: "getCantons",
      endpoint: "ObtenerCantonesLista",
      call: (c) => c.getCantons(),
      params: {}
    },
    {
      name: "getDistricts",
      endpoint: "ObtenerDistritosLista",
      call: (c) => c.getDistricts(),
      params: {}
    },
    {
      name: "getStations",
      endpoint: "ObtenerEstaciones",
      call: (c) => c.getStations(),
      params: {}
    },
    {
      name: "getOperativeStations",
      endpoint: "ObtenerEstacionesOperativas",
      call: (c) => c.getOperativeStations(),
      params: {}
    },
    {
      name: "getStationDetails",
      endpoint: "ObtenerEstacionDetalle",
      call: (c) => c.getStationDetails(2),
      params: { id_estacion: 2 }
    },
    {
      name: "getVehicles",
      endpoint: "ObtenerVehiculosComboF5",
      call: (c) => c.getVehicles(),
      params: {}
    },
    {
      name: "getVehicleDetails",
      endpoint: "ObtenerDatosVehiculo",
      call: (c) => c.getVehicleDetails(140),
      params: { Id_Vehiculo: 140 }
    },
    {
      name: "getVehicleAvailabilityStates",
      endpoint: "ObtenerEstadoDisponibilidadUnidades",
      call: (c) => c.getVehicleAvailabilityStates(),
      params: {}
    },
    { name: "ping", endpoint: "ObtenerProvinciaLista", call: (c) => c.ping(), params: {} }
  ];

  test.each(cases)("$name posts credentials and parameters to $endpoint", async (c) => {
    const { client, calls } = testClient(() => json({ Codigo: "03", Descripcion: "x" }));
    await c.call(client);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`https://sigae.example.test/ws/api/Servicio/${c.endpoint}`);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("content-type")).toBe("application/json");
    expect(call?.body).toEqual({
      IP: CREDENTIALS.ip,
      Password: CREDENTIALS.password,
      Usuario: CREDENTIALS.user,
      codSistema: CREDENTIALS.systemCode,
      ...c.params
    });
  });

  test("keeps every path segment of the base URL, with or without a trailing slash", async () => {
    for (const baseUrl of [
      "https://sigae.example.test/ws/api/Servicio",
      "https://sigae.example.test/ws/api/Servicio/",
      "https://sigae.example.test/ws/api/Servicio//"
    ]) {
      const { client, calls } = testClient(() => json({ Codigo: "03", Descripcion: "x" }), {
        baseUrl
      });
      await client.getProvinces();
      expect(calls[0]?.url).toBe(
        "https://sigae.example.test/ws/api/Servicio/ObtenerProvinciaLista"
      );
    }
  });
});

describe("decoding", () => {
  test.each(allFixtures())("$file decodes to the kind its Codigo implies", async (fixture) => {
    const { client } = testClient(() => json(fixture.body));
    const response = await expectResponse(callEndpoint(client, fixture.endpoint));
    const codigo = fixture.body.Codigo;
    const expected = codigo === "00" ? "ok" : codigo === "03" ? "not_found" : "upstream_error";
    expect(response.kind).toBe(expected);
    expect(response.raw).toEqual(fixture.body);
  });

  test("ok: returns validated data and the raw body", async () => {
    const body = loadFixture("ObtenerBoletaIncidente", "closed");
    const { client } = testClient({ ObtenerBoletaIncidente: () => json(body) });
    const response = await expectResponse(client.getIncidentReport(1900001));
    if (response.kind !== "ok") throw new Error(response.kind);
    expect(response.data.Hora_Aviso).toBe("2026-10-10T20:25:19");
    expect(response.data.Estado_Abierto).toBe("false");
    expect(response.data.Provincia).toBe("SAN JOSE");
    expect(response.raw).toEqual(body);
  });

  test("unknown keys pass through", async () => {
    const body = { ...loadFixture("ObtenerDetalleEmergencias", "closed"), CampoNuevo: [1, 2] };
    const { client } = testClient(() => json(body));
    const response = await expectResponse(client.getIncidentDetails(1900001));
    if (response.kind !== "ok") throw new Error(response.kind);
    expect((response.data as unknown as Record<string, unknown>).CampoNuevo).toEqual([1, 2]);
    expect(response.data.estaciones[0]?.vehiculos[0]?.numero_interno).toBe("M-12");
  });

  test("list responses expose `items` whether SIGAE sends `Items` or `items`", async () => {
    const units = loadFixture("ObtenerUnidadesDespachadasIncidente", "closed");
    const latest = loadFixture("ObtenerListaUltimasEmergenciasApp", "ok");
    const { client } = testClient({
      ObtenerUnidadesDespachadasIncidente: () => json(units),
      ObtenerListaUltimasEmergenciasApp: () => json(latest)
    });

    const unitsResponse = await expectResponse(client.getDispatchedUnits(1900001));
    if (unitsResponse.kind !== "ok") throw new Error(unitsResponse.kind);
    expect(unitsResponse.data.items).toHaveLength(3);
    expect(unitsResponse.data.items[2]?.Unidad).toBe("ATENCION A PIE");
    expect(unitsResponse.data).not.toHaveProperty("Items");
    expect(unitsResponse.raw).toHaveProperty("Items");

    const latestResponse = await expectResponse(client.getLatestIncidents({ count: 50 }));
    if (latestResponse.kind !== "ok") throw new Error(latestResponse.kind);
    expect(latestResponse.data.items.map((item) => item.idBoletaIncidente)).toEqual([
      1900002, 1900001
    ]);
    expect(latestResponse.data.itemsFecha).toHaveLength(1);
  });

  test("normalizes `items` for endpoints that usually send `Items`, and vice versa", async () => {
    const { client } = testClient({
      ObtenerProvinciaLista: () =>
        json({
          Codigo: "00",
          Descripcion: "",
          items: [{ CodigoProvincia: "1", IdProvincia: 1, Provincia: "SAN JOSE" }]
        }),
      ObtenerListaEmergenciasApp: () => json({ Codigo: "00", Descripcion: "", Items: [] })
    });
    const provinces = await expectResponse(client.getProvinces());
    expect(provinces.kind === "ok" && provinces.data.items).toHaveLength(1);
    const list = await expectResponse(
      client.getIncidentsBetween({ from: new Date(), to: new Date() })
    );
    expect(list.kind === "ok" && list.data.items).toEqual([]);
  });

  test("incident types validate nested levels", async () => {
    const body = loadFixture("ObtenerTiposIncidente", "ok");
    const { client } = testClient(() => json(body));
    const response = await expectResponse(client.getIncidentTypes());
    if (response.kind !== "ok") throw new Error(response.kind);
    expect(response.data.items[0]?.items?.[0]?.items?.[0]?.codigo_tipo_incidente).toBe("2.1.3");

    const broken = structuredClone(body) as {
      items: Array<{ items: Array<{ id_tipo_incidente: unknown }> }>;
    };
    broken.items[0]!.items[0]!.id_tipo_incidente = "21";
    const { client: brokenClient } = testClient(() => json(broken));
    const error = await expectError(brokenClient.getIncidentTypes());
    expect(error.kind).toBe("unexpected_shape");
    expect(error.issues?.[0]?.path).toBe("items.0.items.0.id_tipo_incidente");
  });

  test("not_found (03) keeps only the raw body", async () => {
    const body = loadFixture("ObtenerBoletaIncidente", "not-found");
    const { client } = testClient(() => json(body));
    const response = await expectResponse(client.getIncidentReport(1));
    expect(response).toEqual({ kind: "not_found", raw: body });
  });

  test("upstream_error (99) keeps the partial report as data", async () => {
    const body = loadFixture("ObtenerBoletaIncidente", "report-99");
    const { client } = testClient(() => json(body));
    const response = await expectResponse(client.getIncidentReport(1900002));
    if (response.kind !== "upstream_error") throw new Error(response.kind);
    expect(response.code).toBe("99");
    expect(response.description).toContain("Specified cast is not valid");
    expect(response.data.Hora_Aviso).toBe("2026-10-11T23:58:41");
    expect(response.data.Estado_Abierto).toBe("true");
    expect(response.data.Id_Provincia).toBeUndefined();
  });

  test("upstream_error for any other code, including unknown ones", async () => {
    const recorded = loadFixture("recorded/ObtenerProvinciaLista" as SigaeEndpoint, "codigo-04");
    const { client } = testClient({
      ObtenerProvinciaLista: () => json(recorded),
      ObtenerEstaciones: () => json({ Codigo: "42", Descripcion: "nuevo" })
    });
    const provinces = await expectResponse(client.getProvinces());
    expect(provinces.kind === "upstream_error" && provinces.code).toBe("04");
    expect(provinces.kind === "upstream_error" && provinces.data.items).toEqual([]);
    const stations = await expectResponse(client.getStations());
    expect(stations).toMatchObject({ kind: "upstream_error", code: "42", description: "nuevo" });
  });

  test("an error body with invalid fields is unexpected_shape", async () => {
    const body = { ...loadFixture("ObtenerBoletaIncidente", "report-99"), Hora_Aviso: "ayer" };
    const { client } = testClient(() => json(body));
    const error = await expectError(client.getIncidentReport(1900002));
    expect(error.kind).toBe("unexpected_shape");
  });

  test("a format change in a field the sync reads is unexpected_shape", async () => {
    const report = loadFixture("ObtenerBoletaIncidente", "closed");
    const details = loadFixture("ObtenerDetalleEmergencias", "closed");
    const units = loadFixture("ObtenerUnidadesDespachadasIncidente", "closed") as {
      Items: Array<Record<string, unknown>>;
    };
    const changed = structuredClone(units);
    changed.Items[1]!.HoraDespacho = null;

    const cases: Array<[SigaeEndpoint, unknown, string]> = [
      [
        "ObtenerBoletaIncidente",
        { ...report, Hora_Aviso: "2026-10-10T20:25:19-06:00" },
        "Hora_Aviso"
      ],
      ["ObtenerBoletaIncidente", { ...report, Estado_Abierto: true }, "Estado_Abierto"],
      ["ObtenerBoletaIncidente", { ...report, Id_Provincia: "1" }, "Id_Provincia"],
      ["ObtenerDetalleEmergencias", { ...details, latitud: "9.93" }, "latitud"],
      ["ObtenerUnidadesDespachadasIncidente", changed, "items.1.HoraDespacho"]
    ];
    for (const [endpoint, body, path] of cases) {
      const { client } = testClient(() => json(body));
      const error = await expectError(callEndpoint(client, endpoint));
      expect(error.kind, path).toBe("unexpected_shape");
      expect(
        error.issues?.map((issue) => issue.path),
        path
      ).toContain(path);
      expect(error.message).toContain(path);
    }
  });

  test("a body without an envelope is unexpected_shape", async () => {
    for (const body of [[], null, "texto", { Descripcion: "sin código" }, { Codigo: 0 }]) {
      const { client } = testClient(() => json(body));
      const error = await expectError(client.getProvinces());
      expect(error.kind).toBe("unexpected_shape");
      expect(error.endpoint).toBe("ObtenerProvinciaLista");
    }
  });

  test("invalid JSON is invalid_json", async () => {
    const { client } = testClient(() => new Response("<html>Runtime Error</html>"));
    const error = await expectError(client.getProvinces());
    expect(error.kind).toBe("invalid_json");
    expect(error.httpStatus).toBe(200);
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("tolerates a UTF-8 byte order mark", async () => {
    const body = loadFixture("ObtenerProvinciaLista", "ok");
    const { client } = testClient(() => new Response(`\uFEFF${JSON.stringify(body)}`));
    const response = await expectResponse(client.getProvinces());
    expect(response.kind).toBe("ok");
  });
});

describe("transport errors", () => {
  test("non-2xx responses are http errors with the status", async () => {
    for (const status of [400, 404, 500, 502, 503]) {
      const { client } = testClient(() => new Response("error", { status }));
      const error = await expectError(client.getProvinces());
      expect(error.kind).toBe("http");
      expect(error.httpStatus).toBe(status);
      expect(error.message).toContain(`HTTP ${status}`);
    }
  });

  test("407 is a proxy error", async () => {
    const { client } = testClient(() => new Response("", { status: 407 }));
    const error = await expectError(client.getProvinces());
    expect(error.kind).toBe("proxy");
    expect(error.httpStatus).toBe(407);
  });

  test("a rejected fetch is a network error that keeps its cause chain", async () => {
    const { client } = testClient(() => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
          code: "ECONNREFUSED"
        })
      });
    });
    const error = await expectError(client.getIncidentReport(1));
    expect(error.kind).toBe("network");
    expect(error.endpoint).toBe("ObtenerBoletaIncidente");
    expect(error.cause).toMatchObject({ name: "TypeError", message: "fetch failed" });
    expect((error.cause as Error).cause).toMatchObject({
      message: "connect ECONNREFUSED 10.0.0.1:443",
      code: "ECONNREFUSED"
    });
  });

  test("a body that fails mid-read is a network error", async () => {
    const { client } = testClient(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"Codigo":'));
              controller.error(new Error("socket hang up"));
            }
          })
        )
    );
    const error = await expectError(client.getProvinces());
    expect(error.kind).toBe("network");
  });
});

describe("timeouts and aborts", () => {
  test("a request that takes too long is a timeout", async () => {
    const { client } = testClient((call) => hangUntilAborted(call.init.signal), { timeoutMs: 50 });
    const error = await expectError(client.getProvinces());
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("50ms");
    expect(error.durationMs).toBeGreaterThanOrEqual(40);
  });

  test("the timeout also covers reading the body", async () => {
    const { client } = testClient(() => new Response(new ReadableStream({ start() {} })), {
      timeoutMs: 50
    });
    const error = await expectError(client.getProvinces());
    expect(error.kind).toBe("timeout");
  });

  test("timeouts can be overridden per call", async () => {
    const { client } = testClient((call) => hangUntilAborted(call.init.signal), {
      timeoutMs: 60_000
    });
    const error = await expectError(client.getProvinces({ timeoutMs: 30 }));
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("30ms");
  });

  test("defaults to a 15 second timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let settled = false;
      const { client } = testClient((call) => hangUntilAborted(call.init.signal));
      const pending = client.getProvinces().map((response) => {
        settled = true;
        return response;
      });
      void pending.mapErr((error) => {
        settled = true;
        return error;
      });
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await expectError(pending);
      expect(error.kind).toBe("timeout");
      expect(error.message).toContain("15000ms");
    } finally {
      vi.useRealTimers();
    }
  });

  test("an invalid per-call timeout throws without using a slot", async () => {
    const { client } = testClient(() => json(loadFixture("ObtenerProvinciaLista", "ok")), {
      maxConcurrency: 1
    });
    expect(() => client.getProvinces({ timeoutMs: -1 })).toThrow(RangeError);
    expect((await client.getProvinces()).isOk()).toBe(true);
  });

  test("the caller's signal aborts the request", async () => {
    const controller = new AbortController();
    const { client } = testClient((call) => hangUntilAborted(call.init.signal));
    const pending = client.getProvinces({ signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const error = await expectError(pending);
    expect(error.kind).toBe("aborted");
  });

  test("an already aborted signal never reaches fetch", async () => {
    const { client, calls } = testClient(() => json({}));
    const error = await expectError(client.getProvinces({ signal: AbortSignal.abort() }));
    expect(error.kind).toBe("aborted");
    expect(calls).toHaveLength(0);
  });
});

describe("concurrency", () => {
  async function maxInFlight(requests: number, options: { maxConcurrency?: number } = {}) {
    let inFlight = 0;
    let max = 0;
    const body = loadFixture("ObtenerProvinciaLista", "ok");
    const { client } = testClient(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return json(body);
    }, options);
    const results = await Promise.all(
      Array.from({ length: requests }, () => client.getProvinces())
    );
    expect(results.every((result) => result.isOk())).toBe(true);
    return max;
  }

  test("caps requests in flight across all callers", async () => {
    expect(await maxInFlight(7, { maxConcurrency: 2 })).toBe(2);
  });

  test("defaults to 4", async () => {
    expect(await maxInFlight(10)).toBe(4);
  });

  test("frees the slot after errors and timeouts", async () => {
    let attempt = 0;
    const { client } = testClient(
      (call) => {
        attempt++;
        if (attempt === 1) throw new Error("boom");
        if (attempt === 2) return hangUntilAborted(call.init.signal);
        return json(loadFixture("ObtenerProvinciaLista", "ok"));
      },
      { maxConcurrency: 1, timeoutMs: 30 }
    );
    expect((await client.getProvinces()).isErr()).toBe(true);
    expect((await client.getProvinces()).isErr()).toBe(true);
    expect((await client.getProvinces()).isOk()).toBe(true);
  });

  test("a queued request can be aborted while it waits", async () => {
    const { client, calls } = testClient((call) => hangUntilAborted(call.init.signal), {
      maxConcurrency: 1,
      timeoutMs: 200
    });
    const first = client.getProvinces();
    const controller = new AbortController();
    const queued = client.getCantons({ signal: controller.signal });
    controller.abort();
    const error = await expectError(queued);
    expect(error.kind).toBe("aborted");
    expect((await first).isErr()).toBe(true);
    expect(calls.map((call) => call.endpoint)).toEqual(["ObtenerProvinciaLista"]);
  });
});

describe("onResponse", () => {
  test("reports endpoint, outcome, status, Codigo and duration", async () => {
    const events: SigaeResponseEvent[] = [];
    const { client } = testClient(
      {
        ObtenerProvinciaLista: () => json(loadFixture("ObtenerProvinciaLista", "ok")),
        ObtenerBoletaIncidente: () => json(loadFixture("ObtenerBoletaIncidente", "report-99")),
        ObtenerDetalleEmergencias: () =>
          json(loadFixture("ObtenerDetalleEmergencias", "not-found")),
        ObtenerEstaciones: () => new Response("", { status: 500 })
      },
      { onResponse: (event) => events.push(event) }
    );
    await client.getProvinces();
    await client.getIncidentReport(1);
    await client.getIncidentDetails(1);
    await client.getStations();

    expect(events.map(({ durationMs: _, ...event }) => event)).toEqual([
      { endpoint: "ObtenerProvinciaLista", outcome: "ok", httpStatus: 200, codigo: "00" },
      {
        endpoint: "ObtenerBoletaIncidente",
        outcome: "upstream_error",
        httpStatus: 200,
        codigo: "99"
      },
      {
        endpoint: "ObtenerDetalleEmergencias",
        outcome: "not_found",
        httpStatus: 200,
        codigo: "03"
      },
      { endpoint: "ObtenerEstaciones", outcome: "http", httpStatus: 500 }
    ]);
    for (const event of events) expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("a throwing hook does not change the result", async () => {
    const { client } = testClient(() => json(loadFixture("ObtenerProvinciaLista", "ok")), {
      onResponse: () => {
        throw new Error("hook failed");
      }
    });
    const response = await expectResponse(client.getProvinces());
    expect(response.kind).toBe("ok");
  });
});

describe("secrets", () => {
  test("errors and hook events never contain credentials, even when the runtime echoes them", async () => {
    const events: SigaeResponseEvent[] = [];
    const leaky = (call: { body: Record<string, unknown> }) => {
      const inner = Object.assign(
        new Error(`auth ${CREDENTIALS.user}:${CREDENTIALS.password} ${CREDENTIALS.systemCode}`),
        { code: `E_${CREDENTIALS.password}` }
      );
      inner.name = `Error from ${CREDENTIALS.ip}`;
      throw new Error(`request failed: ${JSON.stringify(call.body)}`, { cause: inner });
    };
    const { client } = testClient(leaky, { onResponse: (event) => events.push(event) });
    const error = await expectError(client.getIncidentReport(1));
    const serialized = serializeDeep(error) + JSON.stringify(events) + String(error.stack);
    for (const secret of [...SECRETS, CREDENTIALS.ip]) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[redacted]");
  });

  test("invalid configuration errors do not echo the proxy URL", () => {
    const proxy = "ftp://user:hunter2@proxy.example:21";
    expect(() => createSigaeClient({ baseUrl: BASE_URL, credentials: CREDENTIALS, proxy })).toThrow(
      /`proxy` must be an http\(s\) URL/
    );
    let error: unknown;
    try {
      createSigaeClient({
        baseUrl: BASE_URL,
        credentials: CREDENTIALS,
        proxy: "http://u:hunter2@ bad"
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain("hunter2");
  });
});

describe("configuration", () => {
  test("rejects invalid options", () => {
    expect(() => createSigaeClient({ baseUrl: "nope", credentials: CREDENTIALS })).toThrow(
      TypeError
    );
    expect(() =>
      createSigaeClient({ baseUrl: BASE_URL, credentials: CREDENTIALS, timeoutMs: 0 })
    ).toThrow(RangeError);
    expect(() =>
      createSigaeClient({ baseUrl: BASE_URL, credentials: CREDENTIALS, maxConcurrency: 1.5 })
    ).toThrow(RangeError);
    expect(() =>
      createSigaeClient({
        baseUrl: BASE_URL,
        credentials: CREDENTIALS,
        proxy: "http://proxy.example:8080",
        fetch: async () => new Response()
      })
    ).toThrow(/cannot be combined/);
  });
});

function callEndpoint(client: SigaeClient, endpoint: SigaeEndpoint): AnyResult {
  const calls: Record<SigaeEndpoint, () => AnyResult> = {
    ObtenerDetalleEmergencias: () => client.getIncidentDetails(1),
    ObtenerBoletaIncidente: () => client.getIncidentReport(1),
    ObtenerEstacionesAtiendeIncidente: () => client.getDispatchedStations(1),
    ObtenerUnidadesDespachadasIncidente: () => client.getDispatchedUnits(1),
    ObtenerListaUltimasEmergenciasApp: () => client.getLatestIncidents({ count: 50 }),
    ObtenerListaEmergenciasApp: () =>
      client.getIncidentsBetween({ from: new Date(), to: new Date() }),
    ObtenerTiposIncidente: () => client.getIncidentTypes(),
    ObtenerProvinciaLista: () => client.getProvinces(),
    ObtenerCantonesLista: () => client.getCantons(),
    ObtenerDistritosLista: () => client.getDistricts(),
    ObtenerEstaciones: () => client.getStations(),
    ObtenerEstacionesOperativas: () => client.getOperativeStations(),
    ObtenerEstacionDetalle: () => client.getStationDetails(1),
    ObtenerVehiculosComboF5: () => client.getVehicles(),
    ObtenerDatosVehiculo: () => client.getVehicleDetails(1),
    ObtenerEstadoDisponibilidadUnidades: () => client.getVehicleAvailabilityStates()
  };
  return calls[endpoint]();
}
