import prisma from "../config/prisma.js";
import ExcelJS from "exceljs";
import { rangoDiaHoy, fechaStrAInicio, fechaStrAFin, horaStringMerida, fechaUTCAISOEnMerida, fechaUTCADiaStr, partesEnMerida } from "../utils/timezone.js";
import { evaluarAccesoSocio } from "../utils/membresiaVigencia.js";
import { calcularResumenHorarioAsistencias } from "../utils/asistenciaReporte.js";

const calcularDistancia = (desc1, desc2) => {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) return 1.0; 
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        sum += Math.pow(desc1[i] - desc2[i], 2);
    }
    return Math.sqrt(sum);
};

const sincronizarEstadosVigentes = async (socio, membresia) => {
    const actualizaciones = [];

    if (socio.status !== "activo") {
        actualizaciones.push(
            prisma.socio.update({
                where: { id: socio.id },
                data: { status: "activo" }
            })
        );
    }

    if (membresia?.status !== "activa") {
        actualizaciones.push(
            prisma.membresiaSocio.update({
                where: { id: membresia.id },
                data: { status: "activa" }
            })
        );
    }

    if (actualizaciones.length > 0) {
        await Promise.all(actualizaciones);
    }
};

// VALIDAR ASISTENCIA FACIAL (Kiosco principal)
export const validarAsistenciaFacial = async (req, res) => {
    try {
        const { faceDescriptor, tipo = 'IN', kioskId } = req.body;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
            return res.status(400).json({ success: false, message: "Descriptor facial inválido." });
        }

        const sociosConRostro = await prisma.socio.findMany({
            where: {
                status: { not: "bloqueado" },
                isDeleted: false,
                faceEncoding: { not: null }
            },
            include: {
                membresias: { 
                    where: { status: { not: 'cancelada' } },
                    orderBy: { fechaFin: 'desc' },
                    take: 1, 
                    include: { plan: true } 
                }
            }
        });

        let bestMatch = null;
        let bestDistance = 1.0; 

        for (const socio of sociosConRostro) {
            const dbDescriptor = typeof socio.faceEncoding === 'string' ? JSON.parse(socio.faceEncoding) : socio.faceEncoding;
            const distance = calcularDistancia(faceDescriptor, dbDescriptor);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestMatch = socio;
            }
        }

        const UMBRAL_ACEPTACION = 0.45;

        // CASO 1: ROSTRO NO RECONOCIDO EN ABSOLUTO
        if (bestDistance > UMBRAL_ACEPTACION || !bestMatch) {
            await prisma.intentoAccesoFallido.create({
                data: { faceDescriptor: faceDescriptor, matchDistanceMinimo: bestDistance, dispositivoId: kioskId, ipAddress: clientIp }
            });

            return res.status(200).json({
                success: true, // El request fue exitoso, la decisión de negocio fue "denegado"
                message: "Acceso denegado",
                data: {
                    decision: "denegado",
                    motivo_codigo: "no_registrado",
                    motivo_texto: "Rostro no reconocido por el sistema",
                    socio: null,
                    asistencia: null
                }
            });
        }

        // CASO 2: SOCIO RECONOCIDO - VALIDAMOS REGLAS DE NEGOCIO
        const membresiaActual = bestMatch.membresias[0];
        const nivelConfianza = Math.max(0, (1 - bestDistance) * 100); 
        const evaluacionMembresia = evaluarAccesoSocio(bestMatch, membresiaActual);

        const decision = evaluacionMembresia.permitido ? "permitido" : "denegado";
        const motivo_codigo = evaluacionMembresia.motivoCodigo;
        const motivo_texto = evaluacionMembresia.motivoTexto;
        const estado_acceso = evaluacionMembresia.permitido ? "permitido" : "denegado";
        const tipoAcceso = evaluacionMembresia.permitido ? tipo : "DENEGADO";

        if (evaluacionMembresia.permitido) {
            await sincronizarEstadosVigentes(bestMatch, membresiaActual);
        }

        // REGISTRAR EN BITÁCORA (Tanto permitidos como denegados para trazabilidad)
        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: bestMatch.id,
                tipo: tipoAcceso,
                dispositivoId: kioskId,
                metodo: 'facial',
                confidence: nivelConfianza,
                matchDistance: bestDistance,
                validado: decision === 'permitido',
                estadoAcceso: estado_acceso,
                motivoCodigo: motivo_codigo,
                motivo: motivo_texto
            }
        });

        return res.status(200).json({
            success: true,
            message: decision === 'permitido' ? "Acceso permitido" : "Acceso denegado",
            data: {
                decision: decision,
                motivo_codigo: motivo_codigo,
                motivo_texto: motivo_texto,
                socio: {
                    id: bestMatch.id,
                    codigo_socio: bestMatch.codigoSocio,
                    nombre_completo: bestMatch.nombreCompleto,
                    // Se agrega la foto de perfil si está disponible, de lo contrario se devuelve null
                    foto_perfil_url: bestMatch.fotoUrl || null,
                    membresia: membresiaActual ? membresiaActual.plan.nombre : 'Sin plan',
                    fecha_fin_membresia: membresiaActual ? fechaUTCADiaStr(membresiaActual.fechaFin) : null,
                    estado_pago: membresiaActual ? membresiaActual.estadoPago : 'N/A'
                },
                asistencia: {
                    id: nuevoAcceso.id,
                    tipo: nuevoAcceso.tipo,
                    estado_acceso: nuevoAcceso.estadoAcceso,
                    timestamp: fechaUTCAISOEnMerida(nuevoAcceso.fechaHora),
                    confidence: (1 - bestDistance).toFixed(2) // Formato normalizado (e0.67) solicitado por frontend
                }
            }
        });

    } catch (error) {
        console.error("Error en validación biométrica:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor." });
    }
};

const construirFiltrosHistorial = ({ fecha_inicio, fecha_fin, tipo, metodo, search, estado }) => {
    const condiciones = [];

    if (fecha_inicio || fecha_fin) {
        const fechaHora = {};
        if (fecha_inicio) fechaHora.gte = fechaStrAInicio(fecha_inicio);
        if (fecha_fin) fechaHora.lte = fechaStrAFin(fecha_fin);
        condiciones.push({ fechaHora });
    }

    if (tipo) condiciones.push({ tipo });
    if (metodo) condiciones.push({ metodo });

    if (estado === "denegado") {
        condiciones.push({
            OR: [
                { tipo: "DENEGADO" },
                { estadoAcceso: { equals: "denegado", mode: "insensitive" } }
            ]
        });
    } else if (estado === "permitido") {
        condiciones.push({
            AND: [
                { tipo: { not: "DENEGADO" } },
                { estadoAcceso: { not: "denegado" } }
            ]
        });
    }

    if (search?.trim()) {
        condiciones.push({
            socio: {
                OR: [
                    { nombreCompleto: { contains: search.trim(), mode: "insensitive" } },
                    { codigoSocio: { contains: search.trim(), mode: "insensitive" } }
                ]
            }
        });
    }

    return condiciones.length > 0 ? { AND: condiciones } : {};
};

const aplicarEstiloEncabezado = (row) => {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
    row.alignment = { vertical: "middle", horizontal: "center" };
};

const ajustarColumnas = (worksheet, maxWidth = 45) => {
    worksheet.columns.forEach((column) => {
        let width = 10;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
            width = Math.max(width, String(cell.value ?? "").length + 2);
        });
        column.width = Math.min(width, maxWidth);
    });
};

// HISTORIAL GENERAL DE ASISTENCIAS
export const obtenerHistorialAsistencias = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const whereClause = construirFiltrosHistorial(req.query);

        const [totalRecords, accesos] = await Promise.all([
            prisma.acceso.count({ where: whereClause }),
            prisma.acceso.findMany({
                where: whereClause, skip: skip, take: limit, orderBy: { fechaHora: 'desc' },
                include: { socio: { select: { nombreCompleto: true, codigoSocio: true, fotoUrl: true } }, validador: { select: { nombreCompleto: true } } }
            })
        ]);

        const dataFormateada = accesos.map(a => ({
            id: a.id,
            socio_id: a.socioId,
            socio_nombre: a.socio.nombreCompleto,
            codigo_socio: a.socio.codigoSocio,
            foto_perfil_url: a.socio.fotoUrl,
            timestamp: fechaUTCAISOEnMerida(a.fechaHora),
            tipo: a.tipo, // IN, OUT, DENEGADO
            estado_acceso: a.estadoAcceso, // permitido, denegado
            motivo_codigo: a.motivoCodigo,
            motivo_texto: a.motivo,
            metodo: a.metodo,
            confidence: a.confidence ? parseFloat(a.confidence) : null,
            kiosk_id: a.dispositivoId,
            validador_manual: a.validador ? a.validador.nombreCompleto : null,
            notas: a.motivo 
        }));

        res.status(200).json({
            success: true,
            data: { asistencias: dataFormateada, pagination: { total: totalRecords, page: page, limit: limit, total_pages: Math.ceil(totalRecords / limit) } }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error al obtener el historial." });
    }
};

// EXPORTAR EL HISTORIAL COMPLETO FILTRADO A EXCEL (sin paginación)
export const exportarHistorialAsistencias = async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;

        if (fecha_inicio && fecha_fin && fecha_fin < fecha_inicio) {
            return res.status(400).json({
                success: false,
                message: "La fecha final no puede ser anterior a la fecha inicial."
            });
        }

        const whereClause = construirFiltrosHistorial(req.query);
        const accesos = await prisma.acceso.findMany({
            where: whereClause,
            orderBy: { fechaHora: "desc" },
            include: {
                socio: {
                    select: { nombreCompleto: true, codigoSocio: true }
                },
                validador: { select: { nombreCompleto: true } }
            }
        });

        const {
            entradasPermitidas,
            entradasManana,
            sociosUnicos,
            sociosUnicosManana,
            porcentajeManana,
            porcentajeSociosManana,
            distribucionHoraria
        } = calcularResumenHorarioAsistencias(accesos);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Hexodus";
        workbook.created = new Date();

        const resumen = workbook.addWorksheet("Resumen");
        resumen.addRow(["REPORTE DE ASISTENCIAS"]);
        resumen.getCell("A1").font = { bold: true, size: 16 };
        resumen.addRow(["Periodo", fecha_inicio && fecha_fin ? `${fecha_inicio} al ${fecha_fin}` : fecha_inicio ? `Desde ${fecha_inicio}` : fecha_fin ? `Hasta ${fecha_fin}` : "Todo el historial"]);
        resumen.addRow(["Método", req.query.metodo || "Todos"]);
        resumen.addRow(["Estado", req.query.estado || "Todos"]);
        resumen.addRow(["Búsqueda", req.query.search || "Sin búsqueda"]);
        resumen.addRow(["Definición de mañana", "00:00 a 11:59 (hora de Mérida)"]);
        resumen.addRow([]);
        aplicarEstiloEncabezado(resumen.addRow(["Indicador", "Resultado"]));
        resumen.addRow(["Registros exportados", accesos.length]);
        resumen.addRow(["Entradas permitidas", entradasPermitidas.length]);
        resumen.addRow(["Entradas durante la mañana", entradasManana.length]);
        const filaPorcentaje = resumen.addRow(["Porcentaje de entradas en la mañana", porcentajeManana / 100]);
        filaPorcentaje.getCell(2).numFmt = "0.00%";
        resumen.addRow(["Socios únicos con entrada", sociosUnicos.size]);
        resumen.addRow(["Socios únicos que llegaron en la mañana", sociosUnicosManana.size]);
        const filaPorcentajeSocios = resumen.addRow(["Porcentaje de socios que llegaron en la mañana", porcentajeSociosManana / 100]);
        filaPorcentajeSocios.getCell(2).numFmt = "0.00%";
        ajustarColumnas(resumen);

        const horas = workbook.addWorksheet("Distribución por hora");
        aplicarEstiloEncabezado(horas.addRow(["Hora", "Entradas permitidas", "Porcentaje"]));
        distribucionHoraria.forEach(({ hora, entradas }) => {
            const row = horas.addRow([
                `${String(hora).padStart(2, "0")}:00 - ${String(hora).padStart(2, "0")}:59`,
                entradas,
                entradasPermitidas.length > 0 ? entradas / entradasPermitidas.length : 0
            ]);
            row.getCell(3).numFmt = "0.00%";
        });
        horas.views = [{ state: "frozen", ySplit: 1 }];
        horas.autoFilter = "A1:C25";
        ajustarColumnas(horas);

        const detalle = workbook.addWorksheet("Asistencias");
        aplicarEstiloEncabezado(detalle.addRow([
            "Fecha", "Hora", "Socio", "Código", "Tipo", "Estado", "Método",
            "Confianza", "Motivo", "Validador manual"
        ]));
        accesos.forEach((acceso) => {
            const p = partesEnMerida(acceso.fechaHora);
            const row = detalle.addRow([
                `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`,
                `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`,
                acceso.socio.nombreCompleto,
                acceso.socio.codigoSocio,
                acceso.tipo,
                acceso.estadoAcceso,
                acceso.metodo,
                acceso.confidence == null ? "N/A" : parseFloat(acceso.confidence) / 100,
                acceso.motivo || "",
                acceso.validador?.nombreCompleto || ""
            ]);
            if (acceso.confidence != null) row.getCell(8).numFmt = "0.0%";
        });
        detalle.views = [{ state: "frozen", ySplit: 1 }];
        if (accesos.length > 0) detalle.autoFilter = `A1:J${accesos.length + 1}`;
        ajustarColumnas(detalle);

        const fechaArchivo = fechaUTCADiaStr(new Date());
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="asistencias_${fechaArchivo}.xlsx"`);
        res.setHeader("Content-Length", buffer.length);
        return res.status(200).send(Buffer.from(buffer));
    } catch (error) {
        console.error("Error al exportar asistencias:", error);
        return res.status(500).json({ success: false, message: "Error al generar el reporte de asistencias." });
    }
};

// ASISTENCIAS DE HOY (Dashboards)
export const obtenerAsistenciasHoy = async (req, res) => {
    try {
        const { tipo } = req.query; 

        const { fecha, inicio: inicioHoy, fin: finHoy } = rangoDiaHoy();

        let whereClause = { fechaHora: { gte: inicioHoy, lte: finHoy } };
        if (tipo) whereClause.tipo = tipo;

        const accesos = await prisma.acceso.findMany({
            where: whereClause,
            orderBy: { fechaHora: 'desc' },
            include: { socio: { select: { nombreCompleto: true, codigoSocio: true, fotoUrl: true } } }
        });

        let entradas = 0, salidas = 0, denegados = 0, sumaConfidence = 0, conBiometria = 0;

        const dataFormateada = accesos.map(a => {
            if (a.tipo === 'IN') entradas++;
            else if (a.tipo === 'OUT') salidas++;
            else if (a.tipo === 'DENEGADO') denegados++;

            if (a.confidence) { sumaConfidence += parseFloat(a.confidence); conBiometria++; }

            return {
                id: a.id,
                socio_id: a.socioId,
                socio_nombre: a.socio.nombreCompleto,
                codigo_socio: a.socio.codigoSocio,
                foto_perfil_url: a.socio.fotoUrl,
                hora: horaStringMerida(a.fechaHora),
                tipo: a.tipo,
                estado_acceso: a.estadoAcceso,
                motivo_codigo: a.motivoCodigo,
                motivo_texto: a.motivo,
                metodo: a.metodo,
                confidence: a.confidence ? parseFloat(a.confidence) : null
            };
        });

        res.status(200).json({
            success: true,
            data: {
                fecha,
                asistencias: dataFormateada,
                resumen: {
                    total_asistencias: accesos.length,
                    entradas: entradas,
                    salidas: salidas,
                    denegados: denegados, // NUEVO CONTADOR PARA EL FRONTEND
                    socios_activos_ahora: Math.max(0, entradas - salidas),
                    promedio_confidence: conBiometria > 0 ? Number((sumaConfidence / conBiometria).toFixed(1)) : 0
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error al obtener asistencias del día." });
    }
};

// HISTORIAL DE UN SOCIO ESPECÍFICO
export const obtenerAsistenciasSocio = async (req, res) => {
    try {
        const socioId = parseInt(req.params.id);
        const limit = parseInt(req.query.limit) || 30;

        const socio = await prisma.socio.findUnique({
            where: { id: socioId },
            select: { id: true, codigoSocio: true, nombreCompleto: true, fotoUrl: true }
        });

        if (!socio) return res.status(404).json({ success: false, message: "Socio no encontrado." });

        const asistencias = await prisma.acceso.findMany({
            where: { socioId: socioId },
            orderBy: { fechaHora: 'desc' },
            take: limit
        });

        res.status(200).json({
            success: true,
            data: {
                socio,
                asistencias: asistencias.map(a => ({
                    id: a.id,
                    timestamp: fechaUTCAISOEnMerida(a.fechaHora),
                    tipo: a.tipo,
                    estado_acceso: a.estadoAcceso, 
                    motivo_codigo: a.motivoCodigo, 
                    motivo_texto: a.motivo,       
                    metodo: a.metodo,
                    confidence: a.confidence ? parseFloat(a.confidence) : null
                })),
                estadisticas: {
                    total_mostradas: asistencias.length,
                    ultima_asistencia: asistencias.length > 0 ? fechaUTCAISOEnMerida(asistencias[0].fechaHora) : null
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error al obtener historial del socio." });
    }
};

// REGISTRAR ASISTENCIA MANUAL (Desde Recepción)
export const registrarAsistenciaManual = async (req, res) => {
    try {
        const { clave, tipo = 'IN', notas } = req.body;
        const usuarioId = req.user.id; 

        if (!clave) {
            return res.status(400).json({ success: false, message: "La clave del socio es requerida." });
        }

        const socio = await prisma.socio.findFirst({
            where: { codigoSocio: clave },
            include: { 
                membresias: { 
                    where: { status: { not: 'cancelada' } },
                    orderBy: { fechaFin: 'desc' },
                    take: 1 
                } 
            }
        });

        if (!socio || socio.isDeleted) {
            return res.status(404).json({ success: false, message: `No se encontró ningún socio con la clave: ${clave}` });
        }

        const evaluacionMembresia = evaluarAccesoSocio(socio, socio.membresias[0]);

        if (!evaluacionMembresia.permitido && tipo === 'IN') {
             return res.status(403).json({
                 success: false,
                 message: evaluacionMembresia.motivoTexto,
                 data: {
                     motivo_codigo: evaluacionMembresia.motivoCodigo
                 }
             });
        }

        if (tipo === 'IN') {
            await sincronizarEstadosVigentes(socio, socio.membresias[0]);
        }

        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: socio.id,
                tipo: tipo,
                metodo: 'manual',
                validado: true,
                estadoAcceso: 'permitido',
                motivoCodigo: tipo === 'IN' ? evaluacionMembresia.motivoCodigo : 'ok',
                motivo: notas || (tipo === 'IN' ? evaluacionMembresia.motivoTexto : 'Salida manual por recepción'),
                usuarioId: usuarioId
            }
        });

        res.status(201).json({
            success: true,
            message: "Asistencia registrada manualmente",
            data: {
                id: nuevoAcceso.id,
                socio_id: socio.id,
                clave: socio.codigoSocio,
                nombre: socio.nombreCompleto,
                timestamp: fechaUTCAISOEnMerida(nuevoAcceso.fechaHora),
                tipo: nuevoAcceso.tipo,
                estado_acceso: nuevoAcceso.estadoAcceso,
                motivo_codigo: nuevoAcceso.motivoCodigo,
                metodo: nuevoAcceso.metodo,
                notas: nuevoAcceso.motivo // Para frontend viejo
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error interno al registrar asistencia." });
    }
};

// SINCRONIZAR HUELLAS (Kiosko Local)
export const sincronizarHuellas = async (req, res) => {
    try {
        const sociosConHuella = await prisma.socio.findMany({
            where: {
                status: { not: "bloqueado" },
                isDeleted: false,
                huellaTemplate: { not: null }
            },
            select: { id: true, codigoSocio: true, huellaTemplate: true, huellaUpdatedAt: true }
        });

        res.status(200).json({
            success: true, message: "Sincronización de huellas exitosa",
            data: sociosConHuella, total: sociosConHuella.length
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error interno al obtener los templates biométricos." });
    }
};

// VALIDAR ASISTENCIA (Huella Dactilar Local)
export const validarAsistenciaHuella = async (req, res) => {
    try {
        const { socioId, codigoSocio, tipo = 'IN', kioskId, confidence = 100 } = req.body;

        if (!socioId && !codigoSocio) {
            return res.status(400).json({ success: false, message: "Debes enviar el ID o Código del socio reconocido." });
        }

        const socio = await prisma.socio.findFirst({
            where: {
                OR: [ { id: parseInt(socioId) || undefined }, { codigoSocio: codigoSocio || undefined } ],
                status: { not: "bloqueado" },
                isDeleted: false
            },
            include: { 
                membresias: { 
                    where: { status: { not: 'cancelada' } },
                    orderBy: { fechaFin: 'desc' },
                    take: 1, 
                    include: { plan: true } 
                } 
            }
        });

        if (!socio) {
            return res.status(404).json({ success: false, message: "Socio no encontrado." });
        }

        const membresiaActual = socio.membresias[0];
        const evaluacionMembresia = evaluarAccesoSocio(socio, membresiaActual);

        // Guardamos el acceso denegado sin cambiar la estructura 403 consumida por el kiosco.
        if (!evaluacionMembresia.permitido) {
            
            await prisma.acceso.create({
                data: {
                    socioId: socio.id,
                    tipo: 'DENEGADO',
                    dispositivoId: kioskId,
                    metodo: 'huella',
                    confidence: confidence,
                    validado: false,
                    estadoAcceso: 'denegado',
                    motivoCodigo: evaluacionMembresia.motivoCodigo,
                    motivo: evaluacionMembresia.motivoTexto
                }
            });

            return res.status(403).json({
                success: false,
                message: evaluacionMembresia.motivoTexto,
                data: {
                    motivo_codigo: evaluacionMembresia.motivoCodigo,
                    socio: {
                        nombre_completo: socio.nombreCompleto,
                        codigo_socio: socio.codigoSocio,
                        fecha_fin_membresia: membresiaActual ? fechaUTCADiaStr(membresiaActual.fechaFin) : null
                    },
                    sugerencia: "Por favor, renueva tu membresía en recepción."
                }
            });
        }

        await sincronizarEstadosVigentes(socio, membresiaActual);

        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: socio.id, tipo: tipo, dispositivoId: kioskId, metodo: 'huella', confidence: confidence,
                validado: true,
                estadoAcceso: 'permitido',
                motivoCodigo: evaluacionMembresia.motivoCodigo,
                motivo: evaluacionMembresia.motivoTexto
            }
        });

        return res.status(200).json({
            success: true,
            message: `¡Bienvenido, ${socio.nombreCompleto.split(' ')[0]}!`,
            data: {
                motivo_codigo: evaluacionMembresia.motivoCodigo,
                motivo_texto: evaluacionMembresia.motivoTexto,
                socio: {
                    id: socio.id, codigo_socio: socio.codigoSocio, nombre_completo: socio.nombreCompleto,
                    foto_perfil_url: socio.fotoUrl, membresia: membresiaActual.plan.nombre, fecha_fin_membresia: fechaUTCADiaStr(membresiaActual.fechaFin)
                },
                asistencia: {
                    id: nuevoAcceso.id, tipo: nuevoAcceso.tipo, timestamp: fechaUTCAISOEnMerida(nuevoAcceso.fechaHora), metodo: 'huella',
                    estado_acceso: nuevoAcceso.estadoAcceso
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Error interno del servidor." });
    }
};

// ENDPOINT COMPENSATORIO (MARCAR DENEGADO MANUALMENTE)
export const marcarAsistenciaDenegada = async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo_codigo, motivo_texto } = req.body;

        if (isNaN(id)) return res.status(400).json({ error: "ID inválido." });

        const accesoDb = await prisma.acceso.findUnique({ where: { id: parseInt(id) }});
        if (!accesoDb) return res.status(404).json({ error: "Registro de acceso no encontrado." });

        await prisma.acceso.update({
            where: { id: parseInt(id) },
            data: {
                tipo: 'DENEGADO',
                validado: false,
                estadoAcceso: 'denegado',
                motivoCodigo: motivo_codigo || 'denegado_manual',
                motivo: motivo_texto || 'Denegado manualmente desde recepción'
            }
        });

        res.status(200).json({ message: "Asistencia actualizada a denegada correctamente." });

    } catch (error) {
        res.status(500).json({ error: "Error interno al actualizar la asistencia." });
    }
};
