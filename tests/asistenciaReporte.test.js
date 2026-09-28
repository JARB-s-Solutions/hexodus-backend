import test from "node:test";
import assert from "node:assert/strict";
import { localAUTC } from "../src/utils/timezone.js";
import { calcularResumenHorarioAsistencias } from "../src/utils/asistenciaReporte.js";

const acceso = (socioId, hour, tipo = "IN", estadoAcceso = "permitido") => ({
    socioId,
    tipo,
    estadoAcceso,
    fechaHora: localAUTC(2026, 9, 24, hour, 0, 0, 0),
});

test("considera mañana desde 00:00 hasta 11:59 en Mérida", () => {
    const resultado = calcularResumenHorarioAsistencias([
        acceso(1, 0),
        acceso(2, 11),
        acceso(3, 12),
    ]);

    assert.equal(resultado.entradasPermitidas.length, 3);
    assert.equal(resultado.entradasManana.length, 2);
    assert.equal(resultado.porcentajeManana, 2 / 3 * 100);
    assert.equal(resultado.distribucionHoraria[11].entradas, 1);
    assert.equal(resultado.distribucionHoraria[12].entradas, 1);
});

test("excluye salidas y accesos denegados del cálculo de llegadas", () => {
    const resultado = calcularResumenHorarioAsistencias([
        acceso(1, 8),
        acceso(1, 10, "OUT"),
        acceso(2, 9, "DENEGADO", "denegado"),
    ]);

    assert.equal(resultado.entradasPermitidas.length, 1);
    assert.equal(resultado.entradasManana.length, 1);
    assert.equal(resultado.porcentajeManana, 100);
});

test("calcula personas únicas sin duplicar múltiples visitas del mismo socio", () => {
    const resultado = calcularResumenHorarioAsistencias([
        acceso(1, 8),
        acceso(1, 9),
        acceso(2, 18),
    ]);

    assert.equal(resultado.sociosUnicos.size, 2);
    assert.equal(resultado.sociosUnicosManana.size, 1);
    assert.equal(resultado.porcentajeSociosManana, 50);
});

test("devuelve porcentajes en cero cuando no hay entradas", () => {
    const resultado = calcularResumenHorarioAsistencias([]);

    assert.equal(resultado.porcentajeManana, 0);
    assert.equal(resultado.porcentajeSociosManana, 0);
});
