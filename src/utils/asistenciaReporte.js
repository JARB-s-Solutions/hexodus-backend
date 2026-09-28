import { partesEnMerida } from "./timezone.js";

export const calcularResumenHorarioAsistencias = (accesos) => {
    const entradasPermitidas = accesos.filter((acceso) =>
        acceso.tipo === "IN" &&
        acceso.estadoAcceso?.toLowerCase() !== "denegado"
    );
    const entradasManana = entradasPermitidas.filter(
        (acceso) => partesEnMerida(acceso.fechaHora).hour < 12
    );
    const sociosUnicos = new Set(entradasPermitidas.map((acceso) => acceso.socioId));
    const sociosUnicosManana = new Set(entradasManana.map((acceso) => acceso.socioId));
    const distribucionHoraria = Array.from({ length: 24 }, (_, hora) => ({ hora, entradas: 0 }));

    entradasPermitidas.forEach((acceso) => {
        distribucionHoraria[partesEnMerida(acceso.fechaHora).hour].entradas += 1;
    });

    return {
        entradasPermitidas,
        entradasManana,
        sociosUnicos,
        sociosUnicosManana,
        porcentajeManana: entradasPermitidas.length > 0
            ? (entradasManana.length / entradasPermitidas.length) * 100
            : 0,
        porcentajeSociosManana: sociosUnicos.size > 0
            ? (sociosUnicosManana.size / sociosUnicos.size) * 100
            : 0,
        distribucionHoraria
    };
};
