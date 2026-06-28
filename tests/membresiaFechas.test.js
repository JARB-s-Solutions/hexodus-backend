import test from "node:test";
import assert from "node:assert/strict";
import { calcularFechaFinMembresia } from "../src/utils/membresiaFechas.js";
import { fechaUTCADiaStr, localAUTC } from "../src/utils/timezone.js";

test("calcula membresía mensual como 30 días exactos aunque febrero tenga menos días", () => {
  const inicio = localAUTC(2026, 2, 1, 0, 0, 0, 0);
  const fin = calcularFechaFinMembresia(inicio, 30);

  assert.equal(fechaUTCADiaStr(fin), "2026-03-03");
});

test("calcula membresía mensual como 30 días exactos en año bisiesto", () => {
  const inicio = localAUTC(2028, 2, 1, 0, 0, 0, 0);
  const fin = calcularFechaFinMembresia(inicio, 30);

  assert.equal(fechaUTCADiaStr(fin), "2028-03-02");
});

test("calcula quincena como 15 días exactos", () => {
  const inicio = localAUTC(2026, 6, 15, 0, 0, 0, 0);
  const fin = calcularFechaFinMembresia(inicio, 15);

  assert.equal(fechaUTCADiaStr(fin), "2026-06-30");
});

test("calcula anualidad como 365 días exactos sin ajustar por calendario", () => {
  const inicio = localAUTC(2028, 2, 29, 0, 0, 0, 0);
  const fin = calcularFechaFinMembresia(inicio, 365);

  assert.equal(fechaUTCADiaStr(fin), "2029-02-28");
});
