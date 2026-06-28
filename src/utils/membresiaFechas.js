const MS_POR_DIA = 24 * 60 * 60 * 1000;

export const calcularFechaFinMembresia = (fechaInicio, duracionDias) => {
  const dias = Number(duracionDias);

  if (!(fechaInicio instanceof Date) || isNaN(fechaInicio.getTime())) {
    throw new Error("UX_ERROR:La fecha de inicio de la membresía es inválida.");
  }

  if (!Number.isInteger(dias) || dias <= 0) {
    throw new Error("UX_ERROR:La duración de la membresía es inválida.");
  }

  return new Date(fechaInicio.getTime() + dias * MS_POR_DIA);
};
