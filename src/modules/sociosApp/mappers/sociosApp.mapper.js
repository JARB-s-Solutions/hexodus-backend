const formatDate = (date) => {
  if (!date) return null;

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Merida",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const daysBetween = (fromDate, toDate) => {
  if (!fromDate || !toDate) return null;

  const from = new Date(fromDate);
  const to = new Date(toDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);

  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
};

export const mapSocioForApp = (socio) => {
  const membresia = socio.membresias?.[0] || null;
  const contrato = socio.contratos?.[0] || null;
  const today = new Date();
  const remainingDays = membresia?.fechaFin ? Math.max(daysBetween(today, membresia.fechaFin), 0) : null;
  const isPaid = membresia?.estadoPago === "pagado";
  const isActiveByDate = membresia?.fechaFin ? remainingDays > 0 : false;

  return {
    socio_id: socio.id,
    codigo_socio: socio.codigoSocio,
    nombre_completo: socio.nombreCompleto,
    correo: socio.correo,
    telefono: socio.telefono,
    foto_perfil_url: socio.fotoUrl,
    genero: socio.genero,
    status: socio.status,
    biometria: {
      rostro: Boolean(socio.faceEncoding),
      huella: Boolean(socio.huellaTemplate),
    },
    membresia: membresia
      ? {
          membresia_socio_id: membresia.id,
          plan_id: membresia.planId,
          plan: membresia.plan?.nombre || "Sin plan",
          descripcion: membresia.plan?.descripcion || null,
          status: membresia.status,
          estado_pago: membresia.estadoPago,
          precio: membresia.precioCongelado,
          monto_pendiente: isPaid ? 0 : membresia.precioCongelado,
          fecha_inicio: formatDate(membresia.fechaInicio),
          fecha_fin: formatDate(membresia.fechaFin),
          dias_restantes: remainingDays,
          vigente: isPaid && isActiveByDate && membresia.status === "activa",
        }
      : null,
    contrato: contrato
      ? {
          contrato_socio_id: contrato.id,
          status: contrato.status,
          fecha_inicio: formatDate(contrato.fechaInicio),
          fecha_fin: formatDate(contrato.fechaFin),
          firmado: Boolean(contrato.archivoUrl),
        }
      : null,
    fecha_registro: formatDate(socio.createdAt),
  };
};
