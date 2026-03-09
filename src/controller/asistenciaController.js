import prisma from "../config/prisma.js";

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Lima';

const extraerPartesFechaEnZona = (date, timeZone) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);

    return parts.reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = Number(part.value);
        return acc;
    }, {});
};

const obtenerOffsetZonaMs = (date, timeZone) => {
    const p = extraerPartesFechaEnZona(date, timeZone);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    return asUTC - date.getTime();
};

const fechaHoraZonaAUTC = (year, month, day, hour, minute, second, millisecond, timeZone) => {
    const utcEstimado = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const offset = obtenerOffsetZonaMs(new Date(utcEstimado), timeZone);
    return new Date(utcEstimado - offset);
};

const obtenerRangoDelDiaEnZona = (timeZone) => {
    const ahora = new Date();
    const p = extraerPartesFechaEnZona(ahora, timeZone);

    return {
        fecha: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
        inicio: fechaHoraZonaAUTC(p.year, p.month, p.day, 0, 0, 0, 0, timeZone),
        fin: fechaHoraZonaAUTC(p.year, p.month, p.day, 23, 59, 59, 999, timeZone)
    };
};

// FUNCIÓN MATEMÁTICA: DISTANCIA EUCLIDIANA
// Compara dos arrays de 128 números. Mientras más cercano a 0, más se parecen.
const calcularDistancia = (desc1, desc2) => {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) return 1.0; 
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        sum += Math.pow(desc1[i] - desc2[i], 2);
    }
    return Math.sqrt(sum);
};

// 1. VALIDAR ASISTENCIA (Reconocimiento Facial)
export const validarAsistenciaFacial = async (req, res) => {
    try {
        const { faceDescriptor, tipo = 'IN', kioskId } = req.body;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
            return res.status(400).json({ success: false, message: "Descriptor facial inválido. Deben ser 128 dimensiones." });
        }

        // 1. Obtener solo socios activos que tengan rostro registrado
        const sociosActivos = await prisma.socio.findMany({
            where: { status: 'activo', isDeleted: false, faceEncoding: { not: null } },
            include: {
                membresias: { 
                    where: { status: 'activa' }, 
                    orderBy: { fechaFin: 'desc' }, 
                    take: 1,
                    include: { plan: true }
                }
            }
        });

        // 2. Buscar el mejor Match (El que tenga la distancia más corta)
        let bestMatch = null;
        let bestDistance = 1.0; // 1.0 es el peor caso (muy diferentes)

        for (const socio of sociosActivos) {
            // Prisma devuelve el JSON como un array o un objeto parseado
            const dbDescriptor = typeof socio.faceEncoding === 'string' ? JSON.parse(socio.faceEncoding) : socio.faceEncoding;
            
            const distance = calcularDistancia(faceDescriptor, dbDescriptor);
            
            if (distance < bestDistance) {
                bestDistance = distance;
                bestMatch = socio;
            }
        }

        // UMBRAL DE ACEPTACIÓN: Usualmente 0.4 o 0.5 para Face-API.js. 
        // Ajusta este número según tus pruebas de iluminación. (Menor = Más estricto)
        const UMBRAL_ACEPTACION = 0.45;

        // 3. SI NO HAY MATCH
        if (bestDistance > UMBRAL_ACEPTACION || !bestMatch) {
            // Guardar intento fallido para seguridad/auditoría
            await prisma.intentoAccesoFallido.create({
                data: {
                    faceDescriptor: faceDescriptor,
                    matchDistanceMinimo: bestDistance,
                    dispositivoId: kioskId,
                    ipAddress: clientIp
                }
            });

            return res.status(401).json({
                success: false,
                message: "Rostro no reconocido",
                data: { sugerencia: "Por favor, acércate a recepción." }
            });
        }

        // 4. SI HAY MATCH -> VALIDAR MEMBRESÍA
        const membresiaActual = bestMatch.membresias[0];
        const hoy = new Date();
        const nivelConfianza = Math.max(0, (1 - bestDistance) * 100); // Convierte distancia a % (Ej: 0.4 -> 60% confianza)

        if (!membresiaActual || new Date(membresiaActual.fechaFin) < hoy) {
            return res.status(403).json({
                success: false,
                message: "Membresía vencida o inactiva",
                data: {
                    socio: {
                        nombre_completo: bestMatch.nombreCompleto,
                        codigo_socio: bestMatch.codigoSocio,
                        fecha_fin_membresia: membresiaActual ? membresiaActual.fechaFin : null
                    },
                    sugerencia: "Por favor, renueva tu membresía en recepción."
                }
            });
        }

        // 5. REGISTRAR EL ACCESO EXITOSO
        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: bestMatch.id,
                tipo: tipo, // 'IN' o 'OUT'
                dispositivoId: kioskId,
                metodo: 'facial',
                confidence: nivelConfianza,
                matchDistance: bestDistance,
                validado: true
            }
        });

        // 6. RESPONDER AL KIOSKO PARA ABRIR PUERTA/TORNIQUETE
        return res.status(200).json({
            success: true,
            message: `¡Bienvenido, ${bestMatch.nombreCompleto.split(' ')[0]}!`,
            data: {
                socio: {
                    id: bestMatch.id,
                    codigo_socio: bestMatch.codigoSocio,
                    nombre_completo: bestMatch.nombreCompleto,
                    foto_perfil_url: bestMatch.fotoUrl,
                    membresia: membresiaActual.plan.nombre,
                    fecha_fin_membresia: membresiaActual.fechaFin
                },
                asistencia: {
                    id: nuevoAcceso.id,
                    tipo: nuevoAcceso.tipo,
                    timestamp: nuevoAcceso.fechaHora,
                    confidence: nivelConfianza.toFixed(1)
                }
            }
        });

    } catch (error) {
        console.error("Error en validación biométrica:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor." });
    }
};


// 2. HISTORIAL GENERAL DE ASISTENCIAS
export const obtenerHistorialAsistencias = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const { fecha_inicio, fecha_fin, tipo, metodo, search } = req.query;

        let whereClause = {};

        if (fecha_inicio && fecha_fin) {
            whereClause.fechaHora = {
                gte: new Date(`${fecha_inicio}T00:00:00.000Z`),
                lte: new Date(`${fecha_fin}T23:59:59.999Z`)
            };
        }

        if (tipo) whereClause.tipo = tipo; // 'IN' o 'OUT'
        if (metodo) whereClause.metodo = metodo; // 'facial', 'manual', etc.

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
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { fechaHora: 'desc' },
                include: {
                    socio: { select: { nombreCompleto: true, codigoSocio: true, fotoUrl: true } },
                    validador: { select: { nombreCompleto: true } } // Si fue manual, quién lo dejó pasar
                }
            })
        ]);

        const dataFormateada = accesos.map(a => ({
            id: a.id,
            socio_id: a.socioId,
            socio_nombre: a.socio.nombreCompleto,
            codigo_socio: a.socio.codigoSocio,
            foto_perfil_url: a.socio.fotoUrl,
            timestamp: a.fechaHora,
            tipo: a.tipo,
            metodo: a.metodo,
            confidence: a.confidence ? parseFloat(a.confidence) : null,
            kiosk_id: a.dispositivoId,
            validador_manual: a.validador ? a.validador.nombreCompleto : null,
            notas: a.motivo
        }));

        res.status(200).json({
            success: true,
            data: {
                asistencias: dataFormateada,
                pagination: {
                    total: totalRecords,
                    page: page,
                    limit: limit,
                    total_pages: Math.ceil(totalRecords / limit)
                }
            }
        });
    } catch (error) {
        console.error("Error al obtener historial de asistencias:", error);
        res.status(500).json({ success: false, message: "Error al obtener el historial." });
    }
};

// 3. ASISTENCIAS DE HOY (Para Dashboards Rápidos)
export const obtenerAsistenciasHoy = async (req, res) => {
    try {
        const { tipo } = req.query; // opcional: 'IN' o 'OUT'

        const { fecha, inicio: inicioHoy, fin: finHoy } = obtenerRangoDelDiaEnZona(APP_TIMEZONE);

        let whereClause = { fechaHora: { gte: inicioHoy, lte: finHoy } };
        if (tipo) whereClause.tipo = tipo;

        const accesos = await prisma.acceso.findMany({
            where: whereClause,
            orderBy: { fechaHora: 'desc' },
            include: { socio: { select: { nombreCompleto: true, codigoSocio: true, fotoUrl: true } } }
        });

        let entradas = 0, salidas = 0, sumaConfidence = 0, conBiometria = 0;

        const dataFormateada = accesos.map(a => {
            if (a.tipo === 'IN') entradas++;
            if (a.tipo === 'OUT') salidas++;
            if (a.confidence) {
                sumaConfidence += parseFloat(a.confidence);
                conBiometria++;
            }

            return {
                id: a.id,
                socio_nombre: a.socio.nombreCompleto,
                codigo_socio: a.socio.codigoSocio,
                foto_perfil_url: a.socio.fotoUrl,
                hora: a.fechaHora.toTimeString().split(' ')[0], // "18:30:45"
                tipo: a.tipo,
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
                    socios_activos_ahora: Math.max(0, entradas - salidas),
                    promedio_confidence: conBiometria > 0 ? Number((sumaConfidence / conBiometria).toFixed(1)) : 0
                }
            }
        });
    } catch (error) {
        console.error("Error al obtener asistencias de hoy:", error);
        res.status(500).json({ success: false, message: "Error al obtener asistencias del día." });
    }
};

// 4. HISTORIAL DE UN SOCIO ESPECÍFICO
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
                    timestamp: a.fechaHora,
                    tipo: a.tipo,
                    metodo: a.metodo,
                    confidence: a.confidence ? parseFloat(a.confidence) : null
                })),
                estadisticas: {
                    total_mostradas: asistencias.length,
                    ultima_asistencia: asistencias.length > 0 ? asistencias[0].fechaHora : null
                }
            }
        });
    } catch (error) {
        console.error("Error al obtener asistencias del socio:", error);
        res.status(500).json({ success: false, message: "Error al obtener historial del socio." });
    }
};

// 5. REGISTRAR ASISTENCIA MANUAL (Desde Recepción)
export const registrarAsistenciaManual = async (req, res) => {
    try {
        // Ahora extraemos 'clave' en lugar de 'socio_id'
        const { clave, tipo = 'IN', notas } = req.body;
        const usuarioId = req.user.id; // El recepcionista/admin que está logueado

        if (!clave) {
            return res.status(400).json({ success: false, message: "La clave del socio es requerida (ej. SOC-544935)." });
        }

        // Buscamos al socio usando su código (codigoSocio)
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
             // Bloqueamos la entrada si no tiene membresía vigente
             return res.status(403).json({ success: false, message: "El socio no tiene una membresía activa o vigente." });
        }

        // Registramos el acceso usando el ID interno que acabamos de encontrar
        const nuevoAcceso = await prisma.acceso.create({
            data: {
                socioId: socio.id,
                tipo: tipo,
                metodo: 'manual',
                validado: true,
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
                timestamp: nuevoAcceso.fechaHora,
                tipo: nuevoAcceso.tipo,
                metodo: nuevoAcceso.metodo,
                notas: nuevoAcceso.motivo
            }
        });
    } catch (error) {
        console.error("Error al registrar asistencia manual:", error);
        res.status(500).json({ success: false, message: "Error interno al registrar asistencia." });
    }
};
