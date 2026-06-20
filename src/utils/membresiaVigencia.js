import {
  fechaStrAInicio,
  fechaUTCADiaStr,
  localAUTC,
} from "./timezone.js";

export const inicioDiaMembresia = (fecha = new Date()) =>
  fechaStrAInicio(fechaUTCADiaStr(fecha));

export const finDiaMembresia = (fechaFin) => {
  const [year, month, day] = fechaUTCADiaStr(fechaFin).split("-").map(Number);
  return new Date(localAUTC(year, month, day + 1, 0, 0, 0, 0).getTime() - 1);
};

export const membresiaVigente = (membresia, fecha = new Date()) => {
  if (!membresia?.fechaFin) return false;
  return fechaUTCADiaStr(fecha) <= fechaUTCADiaStr(membresia.fechaFin);
};

export const esUltimoDiaMembresia = (membresia, fecha = new Date()) => {
  if (!membresia?.fechaFin) return false;
  return fechaUTCADiaStr(membresia.fechaFin) === fechaUTCADiaStr(fecha);
};

export const evaluarAccesoMembresia = (membresia, fecha = new Date()) => {
  if (!membresia) {
    return {
      permitido: false,
      estado: "sin_membresia",
      motivoCodigo: "sin_membresia",
      motivoTexto: "Socio sin membresía asignada",
    };
  }

  if (!membresiaVigente(membresia, fecha)) {
    return {
      permitido: false,
      estado: "vencida",
      motivoCodigo: "membresia_vencida",
      motivoTexto: "Membresía vencida",
    };
  }

  if (
    membresia.estadoPago === "sin_pagar" ||
    membresia.estadoPago === "pendiente"
  ) {
    return {
      permitido: false,
      estado: "sin_pago",
      motivoCodigo: "sin_pago",
      motivoTexto: "Membresía sin pagar",
    };
  }

  const ultimoDia = esUltimoDiaMembresia(membresia, fecha);

  return {
    permitido: true,
    estado: ultimoDia ? "proximo_vencer" : "vigente",
    motivoCodigo: ultimoDia ? "proximo_vencer" : "ok",
    motivoTexto: ultimoDia
      ? "Membresía vigente en su último día"
      : "Membresía vigente",
  };
};

export const evaluarAccesoSocio = (
  socio,
  membresia,
  fecha = new Date(),
) => {
  if (!socio || socio.isDeleted) {
    return {
      permitido: false,
      estado: "socio_no_disponible",
      motivoCodigo: "socio_no_disponible",
      motivoTexto: "Socio no encontrado o eliminado",
    };
  }

  if (socio.status === "bloqueado") {
    return {
      permitido: false,
      estado: "socio_bloqueado",
      motivoCodigo: "socio_bloqueado",
      motivoTexto: "Socio bloqueado administrativamente",
    };
  }

  return evaluarAccesoMembresia(membresia, fecha);
};
