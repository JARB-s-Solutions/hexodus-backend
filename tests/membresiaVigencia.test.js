import test from "node:test";
import assert from "node:assert/strict";
import { localAUTC } from "../src/utils/timezone.js";
import {
  esUltimoDiaMembresia,
  evaluarAccesoMembresia,
  evaluarAccesoSocio,
  finDiaMembresia,
  membresiaVigente,
} from "../src/utils/membresiaVigencia.js";

const membresiaPagada = {
  fechaFin: localAUTC(2026, 6, 30, 0, 0, 0, 0),
  estadoPago: "pagado",
};

test("permite acceso durante todo el último día local", () => {
  const duranteElDia = [
    localAUTC(2026, 6, 30, 0, 0, 0, 0),
    localAUTC(2026, 6, 30, 12, 0, 0, 0),
    new Date(localAUTC(2026, 7, 1, 0, 0, 0, 0).getTime() - 1),
  ];

  for (const fecha of duranteElDia) {
    const resultado = evaluarAccesoMembresia(membresiaPagada, fecha);
    assert.equal(resultado.permitido, true);
    assert.equal(resultado.estado, "proximo_vencer");
    assert.equal(resultado.motivoCodigo, "proximo_vencer");
  }
});

test("deniega acceso desde el inicio del día siguiente", () => {
  const fecha = localAUTC(2026, 7, 1, 0, 0, 0, 0);
  const resultado = evaluarAccesoMembresia(membresiaPagada, fecha);

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.estado, "vencida");
  assert.equal(resultado.motivoCodigo, "membresia_vencida");
});

test("mantiene vigente una membresía antes de su último día", () => {
  const fecha = localAUTC(2026, 6, 29, 18, 0, 0, 0);
  const resultado = evaluarAccesoMembresia(membresiaPagada, fecha);

  assert.equal(resultado.permitido, true);
  assert.equal(resultado.estado, "vigente");
  assert.equal(resultado.motivoCodigo, "ok");
});

test("deniega una membresía sin pagar aunque esté en su último día", () => {
  const fecha = localAUTC(2026, 6, 30, 12, 0, 0, 0);
  const resultado = evaluarAccesoMembresia(
    { ...membresiaPagada, estadoPago: "sin_pagar" },
    fecha,
  );

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.estado, "sin_pago");
  assert.equal(resultado.motivoCodigo, "sin_pago");
});

test("prioriza vencimiento sobre adeudo después del último día", () => {
  const fecha = localAUTC(2026, 7, 1, 0, 0, 0, 0);
  const resultado = evaluarAccesoMembresia(
    { ...membresiaPagada, estadoPago: "sin_pagar" },
    fecha,
  );

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.estado, "vencida");
  assert.equal(resultado.motivoCodigo, "membresia_vencida");
});

test("permite un socio inactivo si su membresía sigue vigente", () => {
  const fecha = localAUTC(2026, 6, 30, 12, 0, 0, 0);
  const resultado = evaluarAccesoSocio(
    { status: "inactivo", isDeleted: false },
    membresiaPagada,
    fecha,
  );

  assert.equal(resultado.permitido, true);
  assert.equal(resultado.estado, "proximo_vencer");
});

test("mantiene denegado a un socio bloqueado aunque tenga membresía vigente", () => {
  const fecha = localAUTC(2026, 6, 30, 12, 0, 0, 0);
  const resultado = evaluarAccesoSocio(
    { status: "bloqueado", isDeleted: false },
    membresiaPagada,
    fecha,
  );

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivoCodigo, "socio_bloqueado");
});

test("calcula el límite al final del día de Mérida", () => {
  const limite = finDiaMembresia(membresiaPagada.fechaFin);

  assert.equal(
    limite.getTime(),
    new Date(localAUTC(2026, 7, 1, 0, 0, 0, 0).getTime() - 1).getTime(),
  );
  assert.equal(membresiaVigente(membresiaPagada, limite), true);
  assert.equal(esUltimoDiaMembresia(membresiaPagada, limite), true);
});
