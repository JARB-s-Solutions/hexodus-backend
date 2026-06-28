import prisma from "../config/prisma.js";
import crypto from "crypto";
import ExcelJS from "exceljs";
import { registrarLog } from "../services/auditoriaService.js";
import {
  ahoraEnMerida,
  fechaStrAInicio,
  partesEnMerida,
} from "../utils/timezone.js";
import { inicioDiaMembresia } from "../utils/membresiaVigencia.js";
import { calcularFechaFinMembresia } from "../utils/membresiaFechas.js";

// AYUDANTES DE VALIDACIÓN GLOBALES
const validarFecha = (fechaStr, nombreCampo) => {
  if (!fechaStr) return null;

  let fecha;

  // Si el front manda solo la fecha "YYYY-MM-DD" o la medianoche UTC "T00:00:00"
  if (
    typeof fechaStr === "string" &&
    (fechaStr.length === 10 || fechaStr.includes("T00:00:00"))
  ) {
    const soloFecha = fechaStr.split("T")[0]; // Extrae solo "2026-03-18"
    fecha = fechaStrAInicio(soloFecha); // Lo convierte a la medianoche EXACTA de Campeche
  } else {
    fecha = new Date(fechaStr); // Si trae hora específica (ej. registro biométrico), la respeta
  }

  if (isNaN(fecha.getTime()))
    throw new Error(
      `UX_ERROR:La fecha proporcionada para '${nombreCampo}' es inválida.`,
    );

  // Evitar fechas extremadamente raras por errores de tipeo
  const year = fecha.getFullYear();
  if (year < 2000 || year > 2100)
    throw new Error(
      `UX_ERROR:La fecha para '${nombreCampo}' está fuera de un rango aceptable.`,
    );

  return fecha;
};

// HELPER: Forzar salida de fecha a string local sin la 'Z' (Evita el salto de días en el Frontend)
const formatoLocalISO = (date) => {
  if (!date) return null;
  const p = partesEnMerida(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
};

const formatoLocalFecha = (date) => {
  if (!date) return "";
  const p = partesEnMerida(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

const normalizarTexto = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const obtenerHoyInicioMerida = () => {
  const { year, month, day } = ahoraEnMerida();
  return fechaStrAInicio(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
};

const obtenerEstadoVigenciaMembresia = (membresia, hoy, limite7Dias) => {
  if (!membresia) return "sin_membresia";
  if (new Date(membresia.fechaFin) < hoy) return "vencida";
  if (new Date(membresia.fechaFin) <= limite7Dias) return "por_vencer";
  return "vigente";
};

const obtenerEstadoContratoExport = (contrato, hoy) => {
  if (!contrato) return "sin_contrato";
  if (new Date(contrato.fechaFin) < hoy) return "vencido";

  const limite30Dias = new Date(hoy);
  limite30Dias.setDate(limite30Dias.getDate() + 30);

  if (new Date(contrato.fechaFin) <= limite30Dias) return "por_vencer";
  return "activo";
};

const labelVigencia = {
  vigente: "Vigente",
  por_vencer: "Por vencer",
  vencida: "Vencida",
  sin_membresia: "Sin membresía",
};

const labelContrato = {
  activo: "Activo",
  por_vencer: "Por vencer",
  vencido: "Vencido",
  sin_contrato: "Sin contrato",
};

const normalizarGeneroFiltro = (genero) => {
  const key = String(genero || "todos").trim();
  const map = { M: "Masculino", F: "Femenino", O: "Otro" };
  return map[key] || key;
};

const aplicarEstiloHeader = (row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
};

const ajustarColumnas = (worksheet) => {
  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      maxLength = Math.max(maxLength, Math.min(String(cell.value ?? "").length + 2, 44));
    });
    column.width = maxLength;
  });
};

const agregarTablaSocios = (worksheet, socios) => {
  aplicarEstiloHeader(worksheet.addRow([
    "Código",
    "Socio",
    "Género",
    "Teléfono",
    "Correo",
    "Plan",
    "Vigencia",
    "Estado pago",
    "Inicio membresía",
    "Vencimiento",
    "Precio congelado",
    "Último pago",
    "Método último pago",
    "Contrato firmado",
    "Vigencia contrato",
    "Inicio contrato",
    "Fin contrato",
    "Registro",
  ]));

  socios.forEach((socio) => {
    const row = worksheet.addRow([
      socio.codigo,
      socio.nombre,
      socio.genero,
      socio.telefono,
      socio.correo,
      socio.plan,
      socio.vigenciaLabel,
      socio.estadoPago,
      socio.fechaInicioMembresia,
      socio.fechaFinMembresia,
      socio.precioCongelado,
      socio.ultimoPagoMonto,
      socio.ultimoPagoMetodo,
      socio.contratoFirmado,
      socio.contratoLabel,
      socio.fechaInicioContrato,
      socio.fechaFinContrato,
      socio.fechaRegistro,
    ]);
    row.getCell(11).numFmt = '"$"#,##0.00';
    row.getCell(12).numFmt = '"$"#,##0.00';
  });

  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, socios.length + 1), column: 18 },
  };
  ajustarColumnas(worksheet);
};

const validarMetodoPago = async (tx, metodoId) => {
  if (metodoId) {
    const existe = await tx.metodoPago.findUnique({
      where: { id: parseInt(metodoId) },
    });
    if (!existe)
      throw new Error(
        "NOT_FOUND:El método de pago especificado no existe en el catálogo.",
      );
    return existe.id;
  }
  // Fallback seguro: Si el frontend no manda nada, toma el primer método válido que exista en BD
  const fallback = await tx.metodoPago.findFirst();
  if (!fallback)
    throw new Error(
      "UX_ERROR:No hay métodos de pago registrados en el sistema. Debe registrar al menos uno.",
    );
  return fallback.id;
};

const recalcularStatusSocio = async (tx, socioId) => {
  const inicioHoy = inicioDiaMembresia();

  const membresiaVigentePagada = await tx.membresiaSocio.findFirst({
    where: {
      socioId,
      status: "activa",
      estadoPago: "pagado",
      fechaFin: { gte: inicioHoy },
    },
    select: { id: true },
  });

  await tx.socio.update({
    where: { id: socioId },
    data: { status: membresiaVigentePagada ? "activo" : "inactivo" },
  });
};

// COTIZAR MEMBRESÍA
export const cotizarMembresia = async (req, res) => {
  try {
    const { plan_id, fecha_inicio } = req.body;

    if (!plan_id || !fecha_inicio) {
      return res
        .status(400)
        .json({ error: "Faltan datos para cotizar (plan_id, fecha_inicio)." });
    }

    const plan = await prisma.membresiaPlan.findUnique({
      where: { id: parseInt(plan_id) },
    });

    if (!plan) {
      return res
        .status(404)
        .json({ error: "Plan de membresía no encontrado." });
    }

    // Calcular Fechas blindadas
    const inicio = validarFecha(fecha_inicio, "Inicio de Cotización");
    if (isNaN(inicio.getTime()))
      return res.status(400).json({ error: "La fecha de inicio es inválida." });

    const fin = calcularFechaFinMembresia(inicio, plan.duracionDias);

    // Calcular Precios y Ofertas en tiempo real
    const hoy = new Date();
    const esOfertaActiva =
      plan.esOferta &&
      plan.fechaFinOferta &&
      new Date(plan.fechaFinOferta) >= hoy;
    const precioFinal = esOfertaActiva
      ? parseFloat(plan.precioOferta)
      : parseFloat(plan.precioBase);
    const ahorro = esOfertaActiva
      ? parseFloat(plan.precioBase) - parseFloat(plan.precioOferta)
      : 0;

    res.status(200).json({
      message: "Cotización exitosa",
      data: {
        plan_id: plan.id,
        nombre_plan: plan.nombre,
        duracion_dias: plan.duracionDias,
        fecha_inicio: formatoLocalISO(inicio),
        fecha_vencimiento: formatoLocalISO(fin),
        desglose_cobro: {
          precio_regular: parseFloat(plan.precioBase),
          tiene_descuento: esOfertaActiva,
          ahorro: ahorro,
          total_a_pagar: precioFinal,
        },
      },
    });
  } catch (error) {
    console.error("Error al cotizar:", error);
    res.status(500).json({ error: "Error interno al calcular la cotización." });
  }
};

// CREAR SOCIO + BIOMETRÍA DUAL + CONTRATO + MEMBRESÍA
export const crearSocio = async (req, res) => {
  try {
    const { personal, biometria, detalles_contrato, membresia } = req.body;

    if (!personal || !personal.nombre_completo || !personal.genero) {
      return res
        .status(400)
        .json({ error: "El Nombre Completo y Género son obligatorios." });
    }

    const resultadoTransaccion = await prisma.$transaction(async (tx) => {
      // CREAR SOCIO Y BIOMETRÍA
      const nuevoSocio = await tx.socio.create({
        data: {
          uuidSocio: crypto.randomUUID(),
          codigoSocio: `SOC-${Date.now().toString().slice(-6)}`,
          nombreCompleto: personal.nombre_completo.trim(),
          correo: personal.correo_electronico || null,
          telefono: personal.numero_telefono || null,
          genero: personal.genero,
          createdBy: req.user.id,
          fotoUrl: biometria?.foto_perfil_url || null,
          faceEncoding: biometria?.face_encoding || null,
          faceEncodingUpdatedAt: biometria?.face_encoding_updated_at
            ? validarFecha(
                biometria.face_encoding_updated_at,
                "Actualización Facial",
              )
            : null,
          huellaTemplate: biometria?.fingerprint_template || null,
          huellaUpdatedAt: biometria?.fingerprint_updated_at
            ? validarFecha(
                biometria.fingerprint_updated_at,
                "Actualización Huella",
              )
            : null,
        },
      });

      // CONTRATO
      if (detalles_contrato && detalles_contrato.contrato_firmado) {
        const fInicioContrato = validarFecha(
          detalles_contrato.inicio_contrato,
          "Inicio de Contrato",
        );
        const fFinContrato = validarFecha(
          detalles_contrato.fin_contrato,
          "Fin de Contrato",
        );
        if (!fInicioContrato || !fFinContrato)
          throw new Error(
            "UX_ERROR:Las fechas de contrato son requeridas si el contrato está firmado.",
          );

        await tx.socioContrato.create({
          data: {
            uuidSocioContrato: crypto.randomUUID(),
            socioId: nuevoSocio.id,
            fechaInicio: fInicioContrato,
            fechaFin: fFinContrato,
            status: "vigente",
            createdBy: req.user.id,
          },
        });
      }

      // ASIGNAR MEMBRESÍA
      if (membresia && membresia.plan_id) {
        const plan = await tx.membresiaPlan.findUnique({
          where: { id: parseInt(membresia.plan_id) },
        });
        if (!plan)
          throw new Error(
            "NOT_FOUND:El plan de membresía seleccionado no existe.",
          );

        const fechaInicio = validarFecha(
          membresia.fecha_inicio,
          "Inicio de Membresía",
        );
        if (!fechaInicio)
          throw new Error(
            "UX_ERROR:La fecha de inicio de membresía es requerida.",
          );

        const fechaFin = membresia.fecha_vencimiento
          ? validarFecha(membresia.fecha_vencimiento, "Fin de Membresía")
          : calcularFechaFinMembresia(fechaInicio, plan.duracionDias);

        const hoy = new Date();
        const esOfertaActiva =
          plan.esOferta &&
          plan.fechaFinOferta &&
          new Date(plan.fechaFinOferta) >= hoy;
        const precioFinal = esOfertaActiva
          ? plan.precioOferta
          : plan.precioBase;

        const estadoPagoUI = membresia.estado_pago || "sin_pagar";

        let cajaAbierta = null;
        if (estadoPagoUI === "pagado") {
          cajaAbierta = await tx.corteCaja.findFirst({
            where: { status: "abierto" },
          });
          if (!cajaAbierta) {
            throw new Error("CAJA_CERRADA");
          }
        }

        const membresiaAsignada = await tx.membresiaSocio.create({
          data: {
            uuidMembresiaSocio: crypto.randomUUID(),
            socioId: nuevoSocio.id,
            planId: plan.id,
            fechaInicio: fechaInicio,
            fechaFin: fechaFin,
            status: "activa",
            estadoPago: estadoPagoUI,
            precioCongelado: precioFinal,
            asignadoPor: req.user.id,
          },
        });

        if (estadoPagoUI === "pagado") {
          // LÓGICA DE PAGOS DIVIDIDOS (Retrocompatible)
          const listaPagos =
            membresia.pagos && membresia.pagos.length > 0
              ? membresia.pagos
              : membresia.metodo_pago_id
                ? [
                    {
                      metodo_pago_id: membresia.metodo_pago_id,
                      monto: precioFinal,
                    },
                  ]
                : [];

          if (listaPagos.length === 0) {
            throw new Error(
              "UX_ERROR:Debes proporcionar al menos un método de pago.",
            );
          }

          const totalPagado = listaPagos.reduce(
            (acc, p) => acc + parseFloat(p.monto),
            0,
          );
          if (Math.abs(totalPagado - parseFloat(precioFinal)) > 0.01) {
            throw new Error(
              `UX_ERROR:El total de los pagos ($${totalPagado}) no coincide con el precio de la membresía ($${precioFinal}).`,
            );
          }

          let conceptoMembresia = await tx.concepto.findFirst({
            where: { nombre: "Inscripción / Membresía" },
          });
          if (!conceptoMembresia) {
            conceptoMembresia = await tx.concepto.create({
              data: { nombre: "Inscripción / Membresía", tipo: "ingreso" },
            });
          }

          // REGISTRAR CADA PAGO INDIVIDUALMENTE
          for (const pago of listaPagos) {
            const metodoPagoIdValido = await validarMetodoPago(
              tx,
              pago.metodo_pago_id,
            );
            const montoPago = parseFloat(pago.monto);

            await tx.pagoMembresia.create({
              data: {
                membresiaSocioId: membresiaAsignada.id,
                metodoPagoId: metodoPagoIdValido,
                monto: montoPago,
                recibidoPor: req.user.id,
              },
            });

            await tx.cajaMovimiento.create({
              data: {
                corteId: cajaAbierta.id,
                usuarioId: req.user.id,
                conceptoId: conceptoMembresia.id,
                tipo: "ingreso",
                monto: montoPago,
                referenciaTipo: "membresia",
                referenciaId: membresiaAsignada.id,
                nota: `[Pago: ID ${metodoPagoIdValido}] Suscripción inicial dividida de socio ${nuevoSocio.nombreCompleto} (${nuevoSocio.codigoSocio})`,
              },
            });
          }
        }
      }

      return nuevoSocio;
    });

    res.status(201).json({
      message: "Socio registrado exitosamente.",
      data: {
        socio_id: resultadoTransaccion.id,
        codigo_socio: resultadoTransaccion.codigoSocio,
      },
    });
  } catch (error) {
    console.error("Error al crear socio:", error);

    // Manejo de Errores UX mejorado (Evita los 500 genéricos)
    if (error.message.startsWith("UX_ERROR:"))
      return res
        .status(400)
        .json({ error: error.message.replace("UX_ERROR:", "") });
    if (error.message.startsWith("NOT_FOUND:"))
      return res
        .status(404)
        .json({ error: error.message.replace("NOT_FOUND:", "") });
    if (error.message === "CAJA_CERRADA")
      return res
        .status(403)
        .json({
          error:
            "Operación denegada: No puedes registrar un pago porque la caja está cerrada.",
        });

    res
      .status(500)
      .json({ error: "Error interno del servidor al registrar al socio." });
  }
};

// LISTAR TODOS LOS SOCIOS
export const listarSocios = async (req, res) => {
  try {
    const DEFAULT_LIMIT = 25;
    const MAX_LIMIT = 200;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const rawLimit = req.query.limit;
    const shouldPaginate = rawLimit !== "all";

    const parsedLimit = parseInt(rawLimit, 10);
    const limit = shouldPaginate
      ? Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT
      : null;

    const skip = shouldPaginate ? (page - 1) * limit : 0;

    const { search, estado } = req.query;

    let whereClause = { isDeleted: false };

    if (search) {
      whereClause.OR = [
        { nombreCompleto: { contains: search, mode: "insensitive" } },
        { codigoSocio: { contains: search, mode: "insensitive" } },
        { correo: { contains: search, mode: "insensitive" } },
      ];
    }

    if (estado && estado !== "Todos") {
      whereClause.status = estado;
    }

    const { year: _sy, month: _sm, day: _sd } = ahoraEnMerida();
    const hoy = new Date(Date.UTC(_sy, _sm - 1, _sd, 0, 0, 0, 0));
    const inicioMes = new Date(Date.UTC(_sy, _sm - 1, 1, 0, 0, 0, 0));
    const limite7Dias = new Date(
      Date.UTC(_sy, _sm - 1, _sd + 7, 23, 59, 59, 999),
    );

    const [totalRecords, sociosRaw, sociosGlobalesStats] = await Promise.all([
      prisma.socio.count({ where: whereClause }),
      prisma.socio.findMany({
        where: whereClause,
        ...(shouldPaginate ? { skip, take: limit } : {}),
        orderBy: { createdAt: "desc" },
        include: {
          membresias: {
            include: { plan: true },
            orderBy: { id: "desc" },
            take: 1,
          },
          contratos: {
            orderBy: { id: "desc" },
            take: 1,
          },
        },
      }),
      prisma.socio.findMany({
        where: { isDeleted: false },
        select: {
          createdAt: true,
          membresias: {
            select: { fechaFin: true, status: true },
            orderBy: { id: "desc" },
            take: 1,
          },
        },
      }),
    ]);

    let totalSocios = sociosGlobalesStats.length;
    let nuevosEsteMes = 0,
      activos = 0,
      vencidos = 0,
      vencenEn7Dias = 0;

    sociosGlobalesStats.forEach((socio) => {
      if (socio.createdAt >= inicioMes) nuevosEsteMes++;

      if (socio.membresias.length > 0) {
        const fechaFin = new Date(socio.membresias[0].fechaFin);
        if (fechaFin >= hoy) {
          activos++;
          if (fechaFin <= limite7Dias) vencenEn7Dias++;
        } else {
          vencidos++;
        }
      } else {
        vencidos++;
      }
    });

    const porcentajeActivos =
      totalSocios > 0 ? Math.round((activos / totalSocios) * 100) : 0;

    const dashboard_stats = {
      total_socios: {
        valor: totalSocios,
        etiqueta: `+${nuevosEsteMes} este mes`,
      },
      socios_activos: {
        valor: activos,
        etiqueta: `${porcentajeActivos}% del total`,
      },
      vencidos: { valor: vencidos, etiqueta: "Requieren seguimiento" },
      vencen_en_7_dias: {
        valor: vencenEn7Dias,
        etiqueta: "Renovación pendiente",
      },
    };

    const dataFormateada = sociosRaw.map((socio) => {
      const membresiaActual = socio.membresias[0];
      const contratoActual = socio.contratos[0];

      return {
        socio_id: socio.id,
        clave: socio.codigoSocio,
        nombre: socio.nombreCompleto,
        genero: socio.genero || "N/A",
        contacto: { telefono: socio.telefono, correo: socio.correo },
        membresia: membresiaActual
          ? membresiaActual.plan.nombre
          : "Sin membresía",
        plan_id: membresiaActual ? membresiaActual.planId : null,
        precio_membresia: membresiaActual ? membresiaActual.precioCongelado : null,
        precio_congelado: membresiaActual ? membresiaActual.precioCongelado : null,
        monto_pendiente:
          membresiaActual && membresiaActual.estadoPago === "sin_pagar"
            ? membresiaActual.precioCongelado
            : 0,
        vencimiento: membresiaActual
          ? formatoLocalISO(membresiaActual.fechaFin)
          : null,
        vigencia: membresiaActual
          ? new Date(membresiaActual.fechaFin) >= hoy
            ? "Activa"
            : "Vencida"
          : "N/A",
        estado_pago: membresiaActual ? membresiaActual.estadoPago : "N/A",
        estado_contrato: contratoActual
          ? contratoActual.status === "vigente"
          : false,
      };
    });

    res.status(200).json({
      message: "Lista de socios obtenida correctamente",
      dashboard_stats: dashboard_stats,
      data: dataFormateada,
      pagination: {
        current_page: page,
        limit: shouldPaginate ? limit : totalRecords,
        total_records: totalRecords,
        total_pages: shouldPaginate ? Math.ceil(totalRecords / limit) : 1,
        paginated: shouldPaginate,
      },
    });
  } catch (error) {
    console.error("Error al listar socios:", error);
    res
      .status(500)
      .json({ error: "Error interno al obtener la lista de socios." });
  }
};

// EXPORTAR SOCIOS Y ESTADO DE MEMBRESÍAS
export const exportarSocios = async (req, res) => {
  try {
    const {
      search,
      vigencia = "todos",
      membresia = "todos",
      genero = "todos",
      contrato_firma = "todos",
      contrato_vigencia = "todos",
      fecha_desde,
      fecha_hasta,
    } = req.query;

    const hoy = obtenerHoyInicioMerida();
    const limite7Dias = new Date(hoy);
    limite7Dias.setDate(limite7Dias.getDate() + 7);

    const sociosRaw = await prisma.socio.findMany({
      where: { isDeleted: false },
      orderBy: { nombreCompleto: "asc" },
      include: {
        membresias: {
          include: {
            plan: true,
            pagos: {
              include: { metodoPago: { select: { nombre: true } } },
              orderBy: { pagadoEn: "desc" },
              take: 1,
            },
          },
          orderBy: { fechaFin: "desc" },
          take: 1,
        },
        contratos: {
          orderBy: { fechaFin: "desc" },
          take: 1,
        },
      },
    });

    const searchKey = normalizarTexto(search);
    const membresiaKey = normalizarTexto(membresia);
    const generoFiltro = normalizarGeneroFiltro(genero);
    const fechaDesde = typeof fecha_desde === "string" && fecha_desde ? fecha_desde : "";
    const fechaHasta = typeof fecha_hasta === "string" && fecha_hasta ? fecha_hasta : "";

    const sociosMapeados = sociosRaw.map((socio) => {
      const membresiaActual = socio.membresias[0] || null;
      const contratoActual = socio.contratos[0] || null;
      const ultimoPago = membresiaActual?.pagos?.[0] || null;
      const vigenciaEstado = obtenerEstadoVigenciaMembresia(membresiaActual, hoy, limite7Dias);
      const contratoEstado = obtenerEstadoContratoExport(contratoActual, hoy);

      return {
        id: socio.id,
        codigo: socio.codigoSocio,
        nombre: socio.nombreCompleto,
        genero: socio.genero || "N/A",
        telefono: socio.telefono || "",
        correo: socio.correo || "",
        plan: membresiaActual?.plan?.nombre || "Sin membresía",
        planKey: normalizarTexto(membresiaActual?.plan?.nombre || ""),
        vigenciaEstado,
        vigenciaLabel: labelVigencia[vigenciaEstado] || vigenciaEstado,
        estadoPago: membresiaActual?.estadoPago || "N/A",
        fechaInicioMembresia: membresiaActual ? formatoLocalFecha(membresiaActual.fechaInicio) : "",
        fechaFinMembresia: membresiaActual ? formatoLocalFecha(membresiaActual.fechaFin) : "",
        precioCongelado: membresiaActual?.precioCongelado ? Number(membresiaActual.precioCongelado) : 0,
        ultimoPagoMonto: ultimoPago ? Number(ultimoPago.monto) : 0,
        ultimoPagoMetodo: ultimoPago?.metodoPago?.nombre || "",
        contratoFirmado: contratoActual ? "Sí" : "No",
        contratoEstado,
        contratoLabel: labelContrato[contratoEstado] || contratoEstado,
        fechaInicioContrato: contratoActual ? formatoLocalFecha(contratoActual.fechaInicio) : "",
        fechaFinContrato: contratoActual ? formatoLocalFecha(contratoActual.fechaFin) : "",
        fechaRegistro: formatoLocalFecha(socio.createdAt),
      };
    });

    const sociosFiltrados = sociosMapeados.filter((socio) => {
      if (searchKey) {
        const searchable = normalizarTexto(`${socio.codigo} ${socio.nombre} ${socio.telefono} ${socio.correo}`);
        if (!searchable.includes(searchKey)) return false;
      }

      if (vigencia !== "todos") {
        if (vigencia === "vencida") {
          if (!["vencida", "sin_membresia"].includes(socio.vigenciaEstado)) return false;
        } else if (socio.vigenciaEstado !== vigencia) {
          return false;
        }
      }

      if (membresiaKey && membresiaKey !== "todos" && socio.planKey !== membresiaKey) return false;
      if (generoFiltro !== "todos" && socio.genero !== generoFiltro) return false;

      if (contrato_firma === "firmado" && socio.contratoFirmado !== "Sí") return false;
      if (contrato_firma === "pendiente" && socio.contratoFirmado !== "No") return false;

      if (contrato_vigencia !== "todos" && socio.contratoEstado !== contrato_vigencia) return false;

      if (fechaDesde || fechaHasta) {
        if (!socio.fechaFinMembresia) return false;
        if (fechaDesde && socio.fechaFinMembresia < fechaDesde) return false;
        if (fechaHasta && socio.fechaFinMembresia > fechaHasta) return false;
      }

      return true;
    });

    const resumen = sociosFiltrados.reduce(
      (acc, socio) => {
        acc.total += 1;
        acc[socio.vigenciaEstado] = (acc[socio.vigenciaEstado] || 0) + 1;
        acc.totalAdeudoPotencial += socio.estadoPago === "sin_pagar" ? socio.precioCongelado : 0;
        return acc;
      },
      { total: 0, vigente: 0, por_vencer: 0, vencida: 0, sin_membresia: 0, totalAdeudoPotencial: 0 },
    );

    const resumenPorPlan = new Map();
    sociosFiltrados.forEach((socio) => {
      const item = resumenPorPlan.get(socio.plan) || {
        plan: socio.plan,
        total: 0,
        vigentes: 0,
        porVencer: 0,
        vencidos: 0,
        sinMembresia: 0,
        sinPagar: 0,
      };
      item.total += 1;
      if (socio.vigenciaEstado === "vigente") item.vigentes += 1;
      if (socio.vigenciaEstado === "por_vencer") item.porVencer += 1;
      if (socio.vigenciaEstado === "vencida") item.vencidos += 1;
      if (socio.vigenciaEstado === "sin_membresia") item.sinMembresia += 1;
      if (socio.estadoPago === "sin_pagar") item.sinPagar += 1;
      resumenPorPlan.set(socio.plan, item);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Hexodus";
    workbook.created = new Date();

    const resumenSheet = workbook.addWorksheet("Resumen");
    resumenSheet.addRow(["Reporte", "Socios y membresías"]);
    resumenSheet.addRow(["Generado", formatoLocalISO(new Date())]);
    resumenSheet.addRow(["Filtros", `Vigencia: ${vigencia} | Membresía: ${membresia} | Género: ${genero}`]);
    resumenSheet.addRow([]);
    aplicarEstiloHeader(resumenSheet.addRow(["Indicador", "Valor"]));
    [
      ["Socios exportados", resumen.total],
      ["Vigentes", resumen.vigente],
      ["Por vencer", resumen.por_vencer],
      ["Vencidos", resumen.vencida],
      ["Sin membresía", resumen.sin_membresia],
      ["Adeudo potencial sin pagar", resumen.totalAdeudoPotencial],
    ].forEach(([label, value]) => {
      const row = resumenSheet.addRow([label, value]);
      if (label === "Adeudo potencial sin pagar") row.getCell(2).numFmt = '"$"#,##0.00';
    });
    ajustarColumnas(resumenSheet);

    const sociosSheet = workbook.addWorksheet("Socios");
    agregarTablaSocios(sociosSheet, sociosFiltrados);

    const vencidosSheet = workbook.addWorksheet("Vencidos");
    agregarTablaSocios(
      vencidosSheet,
      sociosFiltrados.filter((socio) => ["vencida", "sin_membresia"].includes(socio.vigenciaEstado)),
    );

    const planesSheet = workbook.addWorksheet("Membresías por plan");
    aplicarEstiloHeader(planesSheet.addRow([
      "Plan",
      "Total socios",
      "Vigentes",
      "Por vencer",
      "Vencidos",
      "Sin membresía",
      "Sin pagar",
    ]));
    Array.from(resumenPorPlan.values())
      .sort((a, b) => b.total - a.total)
      .forEach((plan) => {
        planesSheet.addRow([
          plan.plan,
          plan.total,
          plan.vigentes,
          plan.porVencer,
          plan.vencidos,
          plan.sinMembresia,
          plan.sinPagar,
        ]);
      });
    planesSheet.views = [{ state: "frozen", ySplit: 1 }];
    ajustarColumnas(planesSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    const fechaArchivo = formatoLocalFecha(new Date());

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="socios_membresias_${fechaArchivo}.xlsx"`);
    res.setHeader("Content-Length", buffer.length);

    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error al exportar socios:", error);
    return res.status(500).json({ error: "Error interno al exportar socios." });
  }
};

// OBTENER UN SOCIO EN ESPECÍFICO
export const obtenerSocio = async (req, res) => {
  try {
    const { id } = req.params;

    if (isNaN(id)) {
      return res.status(400).json({ error: "ID de socio inválido." });
    }

    const socio = await prisma.socio.findUnique({
      where: { id: parseInt(id) },
      include: {
        membresias: {
          include: { plan: true },
          orderBy: { id: "desc" },
          take: 1,
        },
        contratos: { orderBy: { id: "desc" }, take: 1 },
      },
    });

    if (!socio || socio.isDeleted) {
      return res.status(404).json({ error: "Socio no encontrado." });
    }

    const membresiaActual = socio.membresias[0];
    const contratoActual = socio.contratos[0];
    const tieneContrato = !!contratoActual;

    const { year: _oy, month: _om, day: _od } = ahoraEnMerida();
    const hoy = new Date(Date.UTC(_oy, _om - 1, _od, 0, 0, 0, 0));

    const dataFormateada = {
      codigo_socio: socio.codigoSocio,
      nombre_completo: socio.nombreCompleto,
      correo: socio.correo || "Sin correo registrado",
      foto_perfil_url: socio.fotoUrl,
      genero: socio.genero || "N/A",
      telefono: socio.telefono || "Sin teléfono",
      membresia: membresiaActual
        ? membresiaActual.plan.nombre
        : "Sin membresía",
      plan_id: membresiaActual ? membresiaActual.planId : null,
      precio_membresia: membresiaActual ? membresiaActual.precioCongelado : null,
      precio_congelado: membresiaActual ? membresiaActual.precioCongelado : null,
      monto_pendiente:
        membresiaActual && membresiaActual.estadoPago === "sin_pagar"
          ? membresiaActual.precioCongelado
          : 0,
      vigencia_membresia: membresiaActual
        ? new Date(membresiaActual.fechaFin) >= hoy
          ? "Vigente"
          : "Vencida"
        : "N/A",
      estado_pago: membresiaActual ? membresiaActual.estadoPago : "N/A",
      fecha_inicio_membresia: membresiaActual
        ? formatoLocalISO(membresiaActual.fechaInicio)
        : null,
      fecha_fin_membresia: membresiaActual ? formatoLocalISO(membresiaActual.fechaFin) : null,
      firmo_contrato: tieneContrato ? true : false,
      estado_contrato: contratoActual ? contratoActual.status : "N/A",
      fecha_inicio_contrato: contratoActual ? formatoLocalISO(contratoActual.fechaInicio) : null,
      fecha_fin_contrato: contratoActual ? formatoLocalISO(contratoActual.fechaFin) : null,
      biometrico_rostro: socio.faceEncoding ? true : false,
      biometrico_huella: socio.huellaTemplate ? true : false,
      fecha_registro: formatoLocalISO(socio.createdAt),
    };

    res
      .status(200)
      .json({
        message: "Datos del socio obtenidos correctamente",
        data: dataFormateada,
      });
  } catch (error) {
    console.error("Error al obtener socio:", error);
    res
      .status(500)
      .json({ error: "Error interno al obtener los datos del socio." });
  }
};

// ACTUALIZAR SOCIO (PUT) - CON CONTABILIDAD DE DOBLE PARTIDA
export const actualizarSocio = async (req, res) => {
  try {
    const { id } = req.params;
    const { personal, biometria, detalles_contrato, membresia } = req.body;

    if (isNaN(id))
      return res.status(400).json({ error: "ID de socio inválido." });
    const socioId = parseInt(id);

    const socioExistente = await prisma.socio.findUnique({
      where: { id: socioId },
    });
    if (!socioExistente || socioExistente.isDeleted)
      return res.status(404).json({ error: "Socio no encontrado." });

    await prisma.$transaction(
      async (tx) => {
        // ACTUALIZAR DATOS PERSONALES Y BIOMETRÍA
        let dataSocio = {};
        if (personal) {
          if (personal.nombre_completo)
            dataSocio.nombreCompleto = personal.nombre_completo.trim();
          if (personal.correo_electronico !== undefined)
            dataSocio.correo = personal.correo_electronico;
          if (personal.numero_telefono !== undefined)
            dataSocio.telefono = personal.numero_telefono;
          if (personal.genero !== undefined) dataSocio.genero = personal.genero;
        }

        if (biometria) {
          if (biometria.foto_perfil_url !== undefined)
            dataSocio.fotoUrl = biometria.foto_perfil_url;
          if (biometria.face_encoding !== undefined) {
            dataSocio.faceEncoding = biometria.face_encoding;
            dataSocio.faceEncodingUpdatedAt = new Date();
          }
          if (biometria.fingerprint_template !== undefined) {
            dataSocio.huellaTemplate = biometria.fingerprint_template;
            dataSocio.huellaUpdatedAt = new Date();
          }
        }

        if (Object.keys(dataSocio).length > 0) {
          await tx.socio.update({ where: { id: socioId }, data: dataSocio });
        }

        // ACTUALIZAR CONTRATO
        if (detalles_contrato) {
          const contratoActual = await tx.socioContrato.findFirst({
            where: { socioId: socioId },
            orderBy: { id: "desc" },
          });

          if (detalles_contrato.contrato_firmado) {
            const fInicioContrato = validarFecha(
              detalles_contrato.inicio_contrato,
              "Inicio de Contrato",
            );
            const fFinContrato = validarFecha(
              detalles_contrato.fin_contrato,
              "Fin de Contrato",
            );
            if (!fInicioContrato || !fFinContrato)
              throw new Error(
                "UX_ERROR:Las fechas de contrato son requeridas.",
              );

            if (contratoActual) {
              await tx.socioContrato.update({
                where: { id: contratoActual.id },
                data: {
                  fechaInicio: fInicioContrato,
                  fechaFin: fFinContrato,
                  status: "vigente",
                },
              });
            } else {
              await tx.socioContrato.create({
                data: {
                  uuidSocioContrato: crypto.randomUUID(),
                  socioId: socioId,
                  fechaInicio: fInicioContrato,
                  fechaFin: fFinContrato,
                  status: "vigente",
                  createdBy: req.user.id,
                },
              });
            }
          } else if (contratoActual && !detalles_contrato.contrato_firmado) {
            const { year: _hy, month: _hm, day: _hd } = ahoraEnMerida();
            const hoy = new Date(Date.UTC(_hy, _hm - 1, _hd, 0, 0, 0, 0));
            const fechaFinContrato = new Date(contratoActual.fechaFin);

            if (
              contratoActual.status === "vigente" &&
              fechaFinContrato >= hoy
            ) {
              throw new Error("REGLA_CONTRATO_VIGENTE");
            } else {
              await tx.socioContrato.update({
                where: { id: contratoActual.id },
                data: { status: "cancelado" },
              });
            }
          }
        }

        // ACTUALIZAR MEMBRESÍA CON LÓGICA CONTABLE (REVERSOS Y COBROS)
        if (membresia && membresia.plan_id) {
          const nuevoPlanId = parseInt(membresia.plan_id);
          const estadoPagoUI = membresia.estado_pago || "sin_pagar";

          // Verificamos si hay una caja abierta por si necesitamos mover dinero
          const cajaAbierta = await tx.corteCaja.findFirst({
            where: { status: "abierto" },
          });

          const membresiaActual = await tx.membresiaSocio.findFirst({
            where: { socioId: socioId },
            orderBy: { id: "desc" },
          });

          // 🛡️ ESCUDO ANTI-FUGAS DE DINERO (BLINDADO POR FECHA) 🛡️
          if (membresiaActual) {
            const hoy = inicioDiaMembresia();
            const estaVencidaPorFecha =
              new Date(membresiaActual.fechaFin) < hoy;

            if (
              membresiaActual.status === "vencida" ||
              membresiaActual.status === "cancelada" ||
              estaVencidaPorFecha
            ) {
              throw new Error(
                "UX_ERROR:Operación denegada. No puedes editar ni generar devoluciones sobre una membresía que ya expiró. Por favor, utiliza el botón de 'Renovar'.",
              );
            }
          }

          const planNuevo = await tx.membresiaPlan.findUnique({
            where: { id: nuevoPlanId },
          });
          if (!planNuevo)
            throw new Error(
              "NOT_FOUND:El plan de membresía seleccionado no existe.",
            );

          const hoy = new Date();
          const esOfertaActiva =
            planNuevo.esOferta &&
            planNuevo.fechaFinOferta &&
            new Date(planNuevo.fechaFinOferta) >= hoy;
          const precioFinal = esOfertaActiva
            ? parseFloat(planNuevo.precioOferta)
            : parseFloat(planNuevo.precioBase);

          // --- AUTO-CÁLCULO DE FECHAS ---
          const fechaInicioReal = validarFecha(
            membresia.fecha_inicio,
            "Inicio de Membresía",
          );
          if (!fechaInicioReal)
            throw new Error(
              "UX_ERROR:La fecha de inicio de membresía es requerida.",
            );

          let fechaFinReal;
          if (membresia.fecha_vencimiento) {
            fechaFinReal = validarFecha(
              membresia.fecha_vencimiento,
              "Fin de Membresía",
            );
          } else {
            fechaFinReal = calcularFechaFinMembresia(
              fechaInicioReal,
              planNuevo.duracionDias,
            );
          }

          let metodoPagoIdValidoCache = null;
          const obtenerMetodoPagoIdValido = async () => {
            if (!metodoPagoIdValidoCache) {
              metodoPagoIdValidoCache = await validarMetodoPago(
                tx,
                membresia.metodo_pago_id,
              );
            }
            return metodoPagoIdValidoCache;
          };

          const registrarCobro = async (membresiaId, monto, nota) => {
            if (monto <= 0) return; // 🔥 ESCUDO: No registrar cobros de $0
            if (!cajaAbierta) throw new Error("CAJA_CERRADA");

            await tx.pagoMembresia.create({
              data: {
                membresiaSocioId: membresiaId,
                metodoPagoId: await obtenerMetodoPagoIdValido(),
                monto: monto,
                recibidoPor: req.user.id,
              },
            });

            let conceptoMembresia = await tx.concepto.findFirst({
              where: { nombre: "Inscripción / Membresía" },
            });
            if (!conceptoMembresia)
              conceptoMembresia = await tx.concepto.create({
                data: { nombre: "Inscripción / Membresía", tipo: "ingreso" },
              });

            await tx.cajaMovimiento.create({
              data: {
                corteId: cajaAbierta.id,
                usuarioId: req.user.id,
                conceptoId: conceptoMembresia.id,
                tipo: "ingreso",
                monto: monto,
                referenciaTipo: "membresia",
                referenciaId: membresiaId,
                nota: `[Pago: ID ${await obtenerMetodoPagoIdValido()}] ${nota}`,
              },
            });
          };

          const registrarReverso = async (membresiaId, monto, nota) => {
            if (monto <= 0) return; // No registrar reversos de $0
            if (!cajaAbierta) throw new Error("CAJA_CERRADA");

            // TRAZABILIDAD: Crear el espejo negativo en los pagos de la membresía
            await tx.pagoMembresia.create({
              data: {
                membresiaSocioId: membresiaId,
                metodoPagoId: await obtenerMetodoPagoIdValido(),
                monto: -Math.abs(monto), // Forzamos el monto a negativo
                recibidoPor: req.user.id,
              },
            });

            // CAJA: Registrar la salida física del dinero
            let conceptoDevolucion = await tx.concepto.findFirst({
              where: { nombre: "Devolución de Membresía" },
            });
            if (!conceptoDevolucion)
              conceptoDevolucion = await tx.concepto.create({
                data: { nombre: "Devolución de Membresía", tipo: "gasto" },
              });

            await tx.cajaMovimiento.create({
              data: {
                corteId: cajaAbierta.id,
                usuarioId: req.user.id,
                conceptoId: conceptoDevolucion.id,
                tipo: "gasto",
                monto: Math.abs(monto),
                referenciaTipo: "membresia",
                referenciaId: membresiaId,
                nota: `[Pago: ID ${await obtenerMetodoPagoIdValido()}] ${nota}`,
              },
            });
          };

          if (membresiaActual) {
            const estadoAnterior = membresiaActual.estadoPago;
            const precioAnterior = parseFloat(
              membresiaActual.precioCongelado || 0,
            );

            // CASO A: CAMBIO DE PLAN
            if (membresiaActual.planId !== nuevoPlanId) {
              // 1. Si la anterior estaba pagada, DEVOLVEMOS el dinero contablemente
              if (estadoAnterior === "pagado") {
                await registrarReverso(
                  membresiaActual.id,
                  precioAnterior,
                  `Reverso por cambio de plan. Socio: ${socioExistente.nombreCompleto} (${socioExistente.codigoSocio})`,
                );
              }

              // 2. Cancelamos la vieja
              await tx.membresiaSocio.update({
                where: { id: membresiaActual.id },
                data: { status: "cancelada" },
              });

              // 3. Creamos la nueva
              const nuevaMembresia = await tx.membresiaSocio.create({
                data: {
                  uuidMembresiaSocio: crypto.randomUUID(),
                  socioId: socioId,
                  planId: nuevoPlanId,
                  fechaInicio: fechaInicioReal,
                  fechaFin: fechaFinReal,
                  status: "activa",
                  estadoPago: estadoPagoUI,
                  precioCongelado: precioFinal,
                  asignadoPor: req.user.id,
                },
              });

              // 4. Cobramos la nueva (si el UI la mandó como pagada)
              if (estadoPagoUI === "pagado") {
                await registrarCobro(
                  nuevaMembresia.id,
                  precioFinal,
                  `Cobro de nuevo plan. Socio: ${socioExistente.nombreCompleto} (${socioExistente.codigoSocio})`,
                );
              }
            }
            // CASO B: MISMO PLAN, SOLO CAMBIARON FECHAS O ESTADO DE PAGO
            else {
              await tx.membresiaSocio.update({
                where: { id: membresiaActual.id },
                data: {
                  fechaInicio: fechaInicioReal,
                  fechaFin: fechaFinReal,
                  estadoPago: estadoPagoUI,
                },
              });

              // Respaldamos el monto: Si el precio anterior era 0 (error de datos viejos), usamos el precio del plan actual.
              const montoOperacion =
                precioAnterior > 0 ? precioAnterior : precioFinal;

              // Si debía el plan y ahora lo pagan
              if (estadoAnterior === "sin_pagar" && estadoPagoUI === "pagado") {
                await registrarCobro(
                  membresiaActual.id,
                  montoOperacion,
                  `Pago atrasado de membresía. Socio: ${socioExistente.nombreCompleto} (${socioExistente.codigoSocio})`,
                );
              }
              // Si estaba pagado y se equivocaron (lo regresan a sin pagar)
              else if (
                estadoAnterior === "pagado" &&
                estadoPagoUI === "sin_pagar"
              ) {
                await registrarReverso(
                  membresiaActual.id,
                  montoOperacion,
                  `Corrección: Membresía a 'Sin Pagar'. Socio: ${socioExistente.nombreCompleto} (${socioExistente.codigoSocio})`,
                );
              }
            }
          } else {
            // CASO C: NO TENÍA MEMBRESÍA
            const nuevaMembresia = await tx.membresiaSocio.create({
              data: {
                uuidMembresiaSocio: crypto.randomUUID(),
                socioId: socioId,
                planId: nuevoPlanId,
                fechaInicio: fechaInicioReal,
                fechaFin: fechaFinReal,
                status: "activa",
                estadoPago: estadoPagoUI,
                precioCongelado: precioFinal,
                asignadoPor: req.user.id,
              },
            });

            if (estadoPagoUI === "pagado") {
              await registrarCobro(
                nuevaMembresia.id,
                precioFinal,
                `Suscripción de membresía asignada. Socio: ${socioExistente.nombreCompleto} (${socioExistente.codigoSocio})`,
              );
            }
          }

          await recalcularStatusSocio(tx, socioId);
        }
      },
      {
        maxWait: 5000,
        timeout: 20000,
      },
    );

    res
      .status(200)
      .json({ message: "Perfil del socio actualizado correctamente." });
  } catch (error) {
    console.error("Error al actualizar socio:", error);

    // Manejo de Errores UX mejorado (Evita los 500 genéricos)
    if (error.message.startsWith("UX_ERROR:"))
      return res
        .status(400)
        .json({ error: error.message.replace("UX_ERROR:", "") });
    if (error.message.startsWith("NOT_FOUND:"))
      return res
        .status(404)
        .json({ error: error.message.replace("NOT_FOUND:", "") });
    if (error.message === "CAJA_CERRADA")
      return res
        .status(403)
        .json({
          error:
            "Operación denegada: La actualización requiere registrar un pago o devolución, pero la caja está cerrada.",
        });
    if (error.message === "REGLA_CONTRATO_VIGENTE")
      return res
        .status(400)
        .json({
          error:
            "No se puede desactivar el contrato porque aún se encuentra vigente.",
        });

    res
      .status(500)
      .json({ error: "Error interno al actualizar el perfil del socio." });
  }
};

// ELIMINAR SOCIO (Borrado Lógico)
export const eliminarSocio = async (req, res) => {
  try {
    const { id } = req.params;

    if (isNaN(id))
      return res.status(400).json({ error: "ID de socio inválido." });

    const socioId = parseInt(id);

    const socioExistente = await prisma.socio.findUnique({
      where: { id: socioId },
      include: {
        membresias: { where: { status: "activa" } },
        contratos: { where: { status: "vigente" } },
      },
    });

    if (!socioExistente || socioExistente.isDeleted) {
      return res
        .status(404)
        .json({ error: "Socio no encontrado o ya fue eliminado." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.socio.update({
        where: { id: socioId },
        data: { isDeleted: true, status: "inactivo" },
      });

      if (socioExistente.membresias.length > 0) {
        await tx.membresiaSocio.update({
          where: { id: socioExistente.membresias[0].id },
          data: { status: "cancelada" },
        });
      }

      if (socioExistente.contratos.length > 0) {
        await tx.socioContrato.update({
          where: { id: socioExistente.contratos[0].id },
          data: { status: "cancelado" },
        });
      }
    });

    await registrarLog({
      req,
      accion: "eliminar",
      modulo: "socios",
      registroId: socioId,
      detalles: `Socio "${socioExistente.nombreCompleto}" (#${socioExistente.codigoSocio}) fue dado de baja del gimnasio`,
    });

    res
      .status(200)
      .json({ message: "Socio eliminado correctamente del sistema." });
  } catch (error) {
    console.error("Error al eliminar socio:", error);
    res
      .status(500)
      .json({ error: "Error interno al intentar eliminar al socio." });
  }
};

// 6. HISTORIAL DE MEMBRESÍAS Y PAGOS
export const obtenerHistorialMembresias = async (req, res) => {
  try {
    const socioId = parseInt(req.params.id);
    if (isNaN(socioId))
      return res.status(400).json({ error: "ID de socio inválido." });

    const socio = await prisma.socio.findUnique({
      where: { id: socioId },
      select: { id: true, nombreCompleto: true, codigoSocio: true },
    });

    if (!socio) return res.status(404).json({ error: "Socio no encontrado." });

    const membresias = await prisma.membresiaSocio.findMany({
      where: { socioId: socioId },
      orderBy: { fechaInicio: "desc" },
      include: {
        plan: { select: { nombre: true, duracionDias: true } },
        pagos: {
          include: {
            metodoPago: { select: { nombre: true } },
            cobrador: { select: { nombreCompleto: true } },
          },
        },
        usuarioAsigna: { select: { nombreCompleto: true } },
      },
    });

    const dataFormateada = membresias.map((m) => ({
      id_membresia_socio: m.id,
      plan: m.plan.nombre,
      fecha_inicio: formatoLocalISO(m.fechaInicio),
      fecha_fin: formatoLocalISO(m.fechaFin),
      status_vigencia: m.status, // activa, vencida, cancelada
      estado_pago: m.estadoPago, // pagado, sin_pagar
      precio_cobrado: m.precioCongelado,
      asignado_por: m.usuarioAsigna?.nombreCompleto || "Sistema",
      pagos: m.pagos.map((p) => ({
        id_pago: p.id,
        monto: p.monto,
        metodo_pago: p.metodoPago.nombre,
        fecha_pago: formatoLocalISO(p.pagadoEn),
        recibido_por: p.cobrador?.nombreCompleto || "Sistema",
      })),
    }));

    res.status(200).json({
      message: "Historial obtenido exitosamente",
      data: { socio, historial: dataFormateada },
    });
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ error: "Error interno al obtener el historial." });
  }
};

// 7. PAGAR MEMBRESÍA PENDIENTE (Atrasada)
export const pagarMembresiaPendiente = async (req, res) => {
  try {
    const socioId = parseInt(req.params.id);
    const { membresia_socio_id, metodo_pago_id, pagos } = req.body; // <-- Añadimos 'pagos'

    if (isNaN(socioId)) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    let datosMembresia = {};
    await prisma.$transaction(async (tx) => {
      const cajaAbierta = await tx.corteCaja.findFirst({
        where: { status: "abierto" },
      });
      if (!cajaAbierta) throw new Error("CAJA_CERRADA");

      let membresia;

      // CASO A: El Front manda el ID específico a pagar
      if (membresia_socio_id) {
        membresia = await tx.membresiaSocio.findUnique({
          where: { id: parseInt(membresia_socio_id) },
          include: { socio: true },
        });
        if (!membresia) throw new Error("NOT_FOUND:La membresía no existe.");
        if (membresia.socioId !== socioId)
          throw new Error(
            "UX_ERROR:La membresía no pertenece a este socio. Verifica no estar enviando el plan_id.",
          );
      }
      // CASO B: El Front no manda ID, buscamos la deuda automáticamente
      else {
        membresia = await tx.membresiaSocio.findFirst({
          where: { socioId: socioId, estadoPago: "sin_pagar" },
          orderBy: { fechaInicio: "desc" }, // Tomamos la más reciente
          include: { socio: true },
        });
        if (!membresia)
          throw new Error(
            "UX_ERROR:Este socio no tiene membresías pendientes de pago.",
          );
      }

      if (membresia.estadoPago === "pagado")
        throw new Error("UX_ERROR:Esta membresía ya se encuentra pagada.");

      datosMembresia = {
        nombreSocio: membresia.socio?.nombreCompleto ?? "Socio",
        codigoSocio: membresia.socio?.codigoSocio ?? "",
        precio: membresia.precioCongelado,
      };

      // LÓGICA DE PAGOS DIVIDIDOS (Deuda Pendiente)
      const listaPagos = pagos && pagos.length > 0
          ? pagos
          : (metodo_pago_id ? [{ metodo_pago_id, monto: membresia.precioCongelado }] : []);

      if (listaPagos.length === 0) {
          throw new Error("UX_ERROR:Debes proporcionar al menos un método de pago.");
      }

      const totalPagado = listaPagos.reduce((acc, p) => acc + parseFloat(p.monto), 0);
      if (Math.abs(totalPagado - parseFloat(membresia.precioCongelado)) > 0.01) {
          throw new Error(`UX_ERROR:El total de los pagos ($${totalPagado}) no coincide con el total de la deuda ($${membresia.precioCongelado}).`);
      }

      let concepto = await tx.concepto.findFirst({
        where: { nombre: "Inscripción / Membresía" },
      });
      if (!concepto)
        concepto = await tx.concepto.create({
          data: { nombre: "Inscripción / Membresía", tipo: "ingreso" },
        });

      // REGISTRAR CADA PAGO INDIVIDUALMENTE EN CAJA Y PAGOMEMBRESIA
      for (const pago of listaPagos) {
          const metodoPagoIdValido = await validarMetodoPago(tx, pago.metodo_pago_id);
          const montoPago = parseFloat(pago.monto);

          // 1. Crear el recibo de pago
          await tx.pagoMembresia.create({
            data: {
              membresiaSocioId: membresia.id,
              metodoPagoId: metodoPagoIdValido,
              monto: montoPago,
              recibidoPor: req.user.id,
            },
          });

          // 2. Ingresar el dinero a la caja
          await tx.cajaMovimiento.create({
            data: {
              corteId: cajaAbierta.id,
              usuarioId: req.user.id,
              conceptoId: concepto.id,
              tipo: "ingreso",
              monto: montoPago,
              referenciaTipo: "membresia",
              referenciaId: membresia.id,
              nota: `[Pago: ID ${metodoPagoIdValido}] Pago dividido de deuda atrasada. Socio: ${membresia.socio.nombreCompleto} (${membresia.socio.codigoSocio})`,
            },
          });
      }

      // 3. Actualizar el estatus a PAGADO
      await tx.membresiaSocio.update({
        where: { id: membresia.id },
        data: { estadoPago: "pagado" },
      });

      // 4. Recalcular status del socio en base a vigencia + pago
      await recalcularStatusSocio(tx, socioId);
    });

    await registrarLog({
      req,
      accion: "pagar",
      modulo: "socios",
      registroId: socioId,
      detalles: `Pago de membresía pendiente registrado para "${datosMembresia.nombreSocio}" (#${datosMembresia.codigoSocio}) — Monto: $${datosMembresia.precio}`,
    });

    res.status(200).json({ message: "Pago registrado correctamente en caja." });
  } catch (error) {
    console.error("Error al pagar membresía:", error);
    if (error.message.startsWith("UX_ERROR:"))
      return res
        .status(400)
        .json({ error: error.message.replace("UX_ERROR:", "") });
    if (error.message.startsWith("NOT_FOUND:"))
      return res
        .status(404)
        .json({ error: error.message.replace("NOT_FOUND:", "") });
    if (error.message === "CAJA_CERRADA")
      return res
        .status(403)
        .json({
          error: "No puedes registrar el pago porque la caja está cerrada.",
        });
    res.status(500).json({ error: "Error interno al procesar el pago." });
  }
};

// 8. RENOVAR MEMBRESÍA (Crear nuevo ciclo)
export const renovarMembresia = async (req, res) => {
  try {
    const socioId = parseInt(req.params.id);
    const { plan_id, metodo_pago_id, fecha_inicio } = req.body;

    if (isNaN(socioId) || !plan_id) {
      return res
        .status(400)
        .json({ error: "El socio y el plan son obligatorios para renovar." });
    }

    let datosRenovacion = {};

    await prisma.$transaction(async (tx) => {
      const socio = await tx.socio.findUnique({
        where: { id: socioId, isDeleted: false },
      });
      if (!socio) throw new Error("NOT_FOUND:Socio no encontrado.");

      const cajaAbierta = await tx.corteCaja.findFirst({
        where: { status: "abierto" },
      });
      if (!cajaAbierta) throw new Error("CAJA_CERRADA");

      const plan = await tx.membresiaPlan.findUnique({
        where: { id: parseInt(plan_id) },
      });
      if (!plan) throw new Error("NOT_FOUND:El plan seleccionado no existe.");

      const membresiaActual = await tx.membresiaSocio.findFirst({
        where: { socioId: socio.id },
        orderBy: { fechaFin: "desc" },
      });

      let fechaInicioReal;
      if (fecha_inicio) {
        fechaInicioReal = validarFecha(fecha_inicio, "Inicio de Renovación");
      } else {
        const { year, month, day } = ahoraEnMerida();
        
        const hoyString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const hoyMerida = fechaStrAInicio(hoyString);

        if (
          membresiaActual &&
          new Date(membresiaActual.fechaFin) >= hoyMerida
        ) {
          fechaInicioReal = new Date(membresiaActual.fechaFin);
        } else {
          fechaInicioReal = hoyMerida;
        }
      }

      const fechaFinReal = calcularFechaFinMembresia(
        fechaInicioReal,
        plan.duracionDias,
      );

      const hoy = new Date();
      const esOfertaActiva =
        plan.esOferta &&
        plan.fechaFinOferta &&
        new Date(plan.fechaFinOferta) >= hoy;
      const precioFinal = esOfertaActiva ? plan.precioOferta : plan.precioBase;

      // VALIDACIÓN DE PAGOS DIVIDIDOS (Membresías)
      const listaPagos =
        req.body.pagos && req.body.pagos.length > 0
          ? req.body.pagos
          : metodo_pago_id
            ? [{ metodo_pago_id, monto: precioFinal }]
            : [];

      if (listaPagos.length === 0) {
        throw new Error(
          "UX_ERROR:Debes proporcionar al menos un método de pago.",
        );
      }

      const totalPagado = listaPagos.reduce(
        (acc, p) => acc + parseFloat(p.monto),
        0,
      );
      if (Math.abs(totalPagado - precioFinal) > 0.01) {
        throw new Error(
          `UX_ERROR:El total de los pagos ($${totalPagado}) no coincide con el precio del plan ($${precioFinal}).`,
        );
      }

      const nuevaMembresia = await tx.membresiaSocio.create({
        data: {
          uuidMembresiaSocio: crypto.randomUUID(),
          socioId: socio.id,
          planId: plan.id,
          fechaInicio: fechaInicioReal,
          fechaFin: fechaFinReal,
          status: "activa",
          estadoPago: "pagado",
          precioCongelado: precioFinal,
          asignadoPor: req.user.id,
        },
      });

      let concepto = await tx.concepto.findFirst({
        where: { nombre: "Renovación de Membresía" },
      });
      if (!concepto)
        concepto = await tx.concepto.create({
          data: { nombre: "Renovación de Membresía", tipo: "ingreso" },
        });

      // REGISTRAR CADA PAGO INDIVIDUALMENTE EN CAJA Y PAGOMEMBRESIA
      for (const pago of listaPagos) {
        const metodoPagoIdValido = await validarMetodoPago(
          tx,
          pago.metodo_pago_id,
        );
        const montoPago = parseFloat(pago.monto);

        await tx.pagoMembresia.create({
          data: {
            membresiaSocioId: nuevaMembresia.id,
            metodoPagoId: metodoPagoIdValido,
            monto: montoPago,
            recibidoPor: req.user.id,
          },
        });

        await tx.cajaMovimiento.create({
          data: {
            corteId: cajaAbierta.id,
            usuarioId: req.user.id,
            conceptoId: concepto.id,
            tipo: "ingreso",
            monto: montoPago,
            referenciaTipo: "membresia",
            referenciaId: nuevaMembresia.id,
            nota: `[Pago: ID ${metodoPagoIdValido}] Renovación dividida socio ${socio.nombreCompleto} (${socio.codigoSocio})`,
          },
        });
      }

      await recalcularStatusSocio(tx, socio.id);

      datosRenovacion = {
        nombreSocio: socio.nombreCompleto,
        codigoSocio: socio.codigoSocio,
        nombrePlan: plan.nombre,
        precio: precioFinal,
      };
    });

    await registrarLog({
      req,
      accion: "renovar",
      modulo: "socios",
      registroId: socioId,
      detalles: `Membresía de "${datosRenovacion.nombreSocio}" (#${datosRenovacion.codigoSocio}) renovada al plan "${datosRenovacion.nombrePlan}" por $${datosRenovacion.precio}`,
    });

    res
      .status(201)
      .json({ message: "Membresía renovada y cobrada exitosamente." });
  } catch (error) {
    console.error("Error al renovar:", error);
    if (error.message.startsWith("UX_ERROR:"))
      return res
        .status(400)
        .json({ error: error.message.replace("UX_ERROR:", "") });
    if (error.message.startsWith("NOT_FOUND:"))
      return res
        .status(404)
        .json({ error: error.message.replace("NOT_FOUND:", "") });
    if (error.message === "CAJA_CERRADA")
      return res
        .status(403)
        .json({ error: "No puedes renovar porque la caja está cerrada." });
    res.status(500).json({ error: "Error interno al procesar la renovación." });
  }
};
