import prisma from "../config/prisma.js";
import { rangoDiaHoy, fechaStrAInicio, fechaStrAFin, horaStringMerida, fechaUTCAISOEnMerida } from "../utils/timezone.js";

const calcularDistancia = (desc1, desc2) => {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) return 1.0; 
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        sum += Math.pow(desc1[i] - desc2[i], 2);
    }
    return Math.sqrt(sum);
};

// VALIDAR ASISTENCIA FACIAL (Kiosco principal)
export const validarAsistenciaFacial = async (req, res) => {
    try {
        const { faceDescriptor, tipo = 'IN', kioskId } = req.body;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
            return res.status(400).json({ success: false, message: "Descriptor facial inválido." });
        }

        const sociosActivos = await prisma.socio.findMany({
            where: { status: 'activo', isDeleted: false, faceEncoding: { not: null } },
            include: {
                membresias: { orderBy: { fechaFin: 'desc' }, take: 1, include: { plan: true } }
            }
        });

        let bestMatch = null;
        let bestDistance = 1.0; 

        for (const socio of sociosActivos) {
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
        const hoy = new Date();
        const nivelConfianza = Math.max(0, (1 - bestDistance) * 100); 

        let decision = "permitido";
        let motivo_codigo = "ok";
        let motivo_texto = "Membresía vigente";
        let estado_acceso = "permitido";
        let tipoAcceso = tipo; 

        if (!membresiaActual) {
            decision = "denegado"; motivo_codigo = "sin_membresia"; motivo_texto = "Socio sin membresía asignada"; estado_acceso = "denegado"; tipoAcceso = "DENEGADO";
        } else if (new Date(membresiaActual.fechaFin) < hoy) {
            decision = "denegado"; motivo_codigo = "membresia_vencida"; motivo_texto = "Membresía vencida"; estado_acceso = "denegado"; tipoAcceso = "DENEGADO";
        } else if (membresiaActual.estadoPago === 'sin_pagar') {
            decision = "denegado"; motivo_codigo = "sin_pago"; motivo_texto = "Membresía sin pagar"; estado_acceso = "denegado"; tipoAcceso = "DENEGADO";
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
                    membresia: membresiaActual ? membresiaActual.plan.nombre : 'Sin plan',
                    fecha_fin_membresia: membresiaActual ? membresiaActual.fechaFin : null,
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

// HISTORIAL GENERAL DE ASISTENCIAS
export const obtenerHistorialAsistencias = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const { fecha_inicio, fecha_fin, tipo, metodo, search } = req.query;
        let whereClause = {};

        if (fecha_inicio && fecha_fin) {
            whereClause.fechaHora = {
                gte: fechaStrAInicio(fecha_inicio),
                lte: fechaStrAFin(fecha_fin)
            };
        }

        if (tipo) whereClause.tipo = tipo; 
        if (metodo) whereClause.metodo = metodo; 

        if (search) {
            whereClause.socio = {
                OR: [
                    { nombreCompleto: { contains: search, mode: 'insensitive' } },
                    { codigoSocio: { contains: search, mode: 'insensitive' } }
                ]
            };
        }

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
            include: { membresias: { where: { status: 'activa' }, take: 1 } }
        });

        if (!socio || socio.isDeleted) {
            return res.status(404).json({ success: false, message: `No se encontró ningún socio con la clave: ${clave}` });
        }

        const hoy = new Date();
        const tieneMembresia = socio.membresias.length > 0 && new Date(socio.membresias[0].fechaFin) >= hoy;

        if (!tieneMembresia && tipo === 'IN') {
             return res.status(403).json({ success: false, message: "El socio no tiene una membresía activa o vigente." });
        }

        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: socio.id,
                tipo: tipo,
                metodo: 'manual',
                validado: true,
                estadoAcceso: 'permitido',
                motivoCodigo: 'ok',
                motivo: notas || 'Ingreso manual por recepción',
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
            where: { status: 'activo', isDeleted: false, huellaTemplate: { not: null } },
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
                status: 'activo', isDeleted: false
            },
            include: { membresias: { where: { status: 'activa' }, orderBy: { fechaFin: 'desc' }, take: 1, include: { plan: true } } }
        });

        if (!socio) {
            return res.status(404).json({ success: false, message: "Socio no encontrado o inactivo." });
        }

        const membresiaActual = socio.membresias[0];
        const hoy = new Date();

        // Si la membresía venció o no tiene, guardamos el log de DENEGADO sin romper la estructura de respuesta (403) del front viejo
        if (!membresiaActual || new Date(membresiaActual.fechaFin) < hoy) {
            
            await prisma.acceso.create({
                data: {
                    socioId: socio.id,
                    tipo: 'DENEGADO',
                    dispositivoId: kioskId,
                    metodo: 'huella',
                    confidence: confidence,
                    validado: false,
                    estadoAcceso: 'denegado',
                    motivoCodigo: !membresiaActual ? 'sin_membresia' : 'membresia_vencida',
                    motivo: !membresiaActual ? 'Sin membresía' : 'Membresía vencida'
                }
            });

            return res.status(403).json({
                success: false,
                message: "Membresía vencida o inactiva",
                data: {
                    socio: {
                        nombre_completo: socio.nombreCompleto,
                        codigo_socio: socio.codigoSocio,
                        fecha_fin_membresia: membresiaActual ? membresiaActual.fechaFin : null
                    },
                    sugerencia: "Por favor, renueva tu membresía en recepción."
                }
            });
        }

        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: socio.id, tipo: tipo, dispositivoId: kioskId, metodo: 'huella', confidence: confidence,
                validado: true, estadoAcceso: 'permitido', motivoCodigo: 'ok', motivo: 'Membresía vigente'
            }
        });

        return res.status(200).json({
            success: true,
            message: `¡Bienvenido, ${socio.nombreCompleto.split(' ')[0]}!`,
            data: {
                socio: {
                    id: socio.id, codigo_socio: socio.codigoSocio, nombre_completo: socio.nombreCompleto,
                    foto_perfil_url: socio.fotoUrl, membresia: membresiaActual.plan.nombre, fecha_fin_membresia: membresiaActual.fechaFin
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