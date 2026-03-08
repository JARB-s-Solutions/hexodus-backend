import prisma from "../config/prisma.js";
import crypto from "crypto";
import { registrarLog } from "../services/auditoriaService.js";

// AYUDANTES DE VALIDACIÓN GLOBALES
const validarFecha = (fechaStr, nombreCampo) => {
    if (!fechaStr) return null;
    const fecha = new Date(fechaStr);
    if (isNaN(fecha.getTime())) throw new Error(`UX_ERROR:La fecha proporcionada para '${nombreCampo}' es inválida.`);
    
    // Evitar fechas extremadamente raras por errores de tipeo del usuario (ej. año 0024 en vez de 2024)
    const year = fecha.getFullYear();
    if (year < 2000 || year > 2100) throw new Error(`UX_ERROR:La fecha para '${nombreCampo}' está fuera de un rango aceptable.`);
    
    return fecha;
};

const validarMetodoPago = async (tx, metodoId) => {
    if (metodoId) {
        const existe = await tx.metodoPago.findUnique({ where: { id: parseInt(metodoId) } });
        if (!existe) throw new Error("NOT_FOUND:El método de pago especificado no existe en el catálogo.");
        return existe.id;
    }
    // Fallback seguro: Si el frontend no manda nada, toma el primer método válido que exista en BD
    const fallback = await tx.metodoPago.findFirst();
    if (!fallback) throw new Error("UX_ERROR:No hay métodos de pago registrados en el sistema. Debe registrar al menos uno.");
    return fallback.id;
};


// COTIZAR MEMBRESÍA
export const cotizarMembresia = async (req, res) => {
    try {
        const { plan_id, fecha_inicio } = req.body;

        if (!plan_id || !fecha_inicio) {
            return res.status(400).json({ error: "Faltan datos para cotizar (plan_id, fecha_inicio)." });
        }

        const plan = await prisma.membresiaPlan.findUnique({
            where: { id: parseInt(plan_id) }
        });

        if (!plan) {
            return res.status(404).json({ error: "Plan de membresía no encontrado." });
        }

        // Calcular Fechas blindadas
        const inicio = new Date(fecha_inicio);
        if (isNaN(inicio.getTime())) return res.status(400).json({ error: "La fecha de inicio es inválida." });
        
        const fin = new Date(inicio);
        fin.setDate(fin.getDate() + plan.duracionDias);

        // Calcular Precios y Ofertas en tiempo real
        const hoy = new Date();
        const esOfertaActiva = plan.esOferta && plan.fechaFinOferta && new Date(plan.fechaFinOferta) >= hoy;
        const precioFinal = esOfertaActiva ? parseFloat(plan.precioOferta) : parseFloat(plan.precioBase);
        const ahorro = esOfertaActiva ? parseFloat(plan.precioBase) - parseFloat(plan.precioOferta) : 0;

        res.status(200).json({
            message: "Cotización exitosa",
            data: {
                plan_id: plan.id,
                nombre_plan: plan.nombre,
                duracion_dias: plan.duracionDias,
                fecha_inicio: inicio.toISOString(),
                fecha_vencimiento: fin.toISOString(),
                desglose_cobro: {
                    precio_regular: parseFloat(plan.precioBase),
                    tiene_descuento: esOfertaActiva,
                    ahorro: ahorro,
                    total_a_pagar: precioFinal
                }
            }
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
            return res.status(400).json({ error: "El Nombre Completo y Género son obligatorios." });
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
                    faceEncodingUpdatedAt: biometria?.face_encoding_updated_at ? validarFecha(biometria.face_encoding_updated_at, 'Actualización Facial') : null,
                    huellaTemplate: biometria?.fingerprint_template || null,
                    huellaUpdatedAt: biometria?.fingerprint_updated_at ? validarFecha(biometria.fingerprint_updated_at, 'Actualización Huella') : null,
                }
            });

            // CONTRATO 
            if (detalles_contrato && detalles_contrato.contrato_firmado) {
                const fInicioContrato = validarFecha(detalles_contrato.inicio_contrato, 'Inicio de Contrato');
                const fFinContrato = validarFecha(detalles_contrato.fin_contrato, 'Fin de Contrato');
                if(!fInicioContrato || !fFinContrato) throw new Error("UX_ERROR:Las fechas de contrato son requeridas si el contrato está firmado.");

                await tx.socioContrato.create({
                    data: {
                        uuidSocioContrato: crypto.randomUUID(),
                        socioId: nuevoSocio.id,
                        fechaInicio: fInicioContrato,
                        fechaFin: fFinContrato,
                        status: 'vigente',
                        createdBy: req.user.id
                    }
                });
            }

            // ASIGNAR MEMBRESÍA 
            if (membresia && membresia.plan_id) {
                const plan = await tx.membresiaPlan.findUnique({ where: { id: parseInt(membresia.plan_id) } });
                if (!plan) throw new Error("NOT_FOUND:El plan de membresía seleccionado no existe.");

                const fechaInicio = validarFecha(membresia.fecha_inicio, 'Inicio de Membresía');
                if(!fechaInicio) throw new Error("UX_ERROR:La fecha de inicio de membresía es requerida.");

                let fechaFin = membresia.fecha_vencimiento ? validarFecha(membresia.fecha_vencimiento, 'Fin de Membresía') : new Date(fechaInicio);
                if (!membresia.fecha_vencimiento) {
                    fechaFin.setDate(fechaFin.getDate() + plan.duracionDias);
                }

                const hoy = new Date();
                const esOfertaActiva = plan.esOferta && plan.fechaFinOferta && new Date(plan.fechaFinOferta) >= hoy;
                const precioFinal = esOfertaActiva ? plan.precioOferta : plan.precioBase;

                const estadoPagoUI = membresia.estado_pago || 'sin_pagar'; 
                
                let cajaAbierta = null;
                if (estadoPagoUI === 'pagado') {
                    cajaAbierta = await tx.corteCaja.findFirst({ where: { status: 'abierto' } });
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
                        status: 'activa',
                        estadoPago: estadoPagoUI,
                        precioCongelado: precioFinal,
                        asignadoPor: req.user.id
                    }
                });

                if (estadoPagoUI === 'pagado') {
                    const metodoPagoIdValido = await validarMetodoPago(tx, membresia.metodo_pago_id);

                    await tx.pagoMembresia.create({
                        data: {
                            membresiaSocioId: membresiaAsignada.id,
                            metodoPagoId: metodoPagoIdValido, 
                            monto: precioFinal,
                            recibidoPor: req.user.id
                        }
                    });

                    let conceptoMembresia = await tx.concepto.findFirst({ where: { nombre: 'Inscripción / Membresía' } });
                    if (!conceptoMembresia) {
                        conceptoMembresia = await tx.concepto.create({ data: { nombre: 'Inscripción / Membresía', tipo: 'ingreso' } });
                    }

                    await tx.cajaMovimiento.create({
                        data: {
                            corteId: cajaAbierta.id, 
                            usuarioId: req.user.id,
                            conceptoId: conceptoMembresia.id,
                            tipo: 'ingreso',
                            monto: precioFinal,
                            referenciaTipo: 'membresia',
                            referenciaId: membresiaAsignada.id,
                            nota: `Suscripción inicial de socio ${nuevoSocio.codigoSocio}`
                        }
                    });
                }
            }

            return nuevoSocio;
        });

        res.status(201).json({
            message: "Socio registrado exitosamente.",
            data: {
                socio_id: resultadoTransaccion.id,
                codigo_socio: resultadoTransaccion.codigoSocio
            }
        });

    } catch (error) {
        console.error("Error al crear socio:", error);
        
        // Manejo de Errores UX mejorado (Evita los 500 genéricos)
        if (error.message.startsWith("UX_ERROR:")) return res.status(400).json({ error: error.message.replace("UX_ERROR:", "") });
        if (error.message.startsWith("NOT_FOUND:")) return res.status(404).json({ error: error.message.replace("NOT_FOUND:", "") });
        if (error.message === "CAJA_CERRADA") return res.status(403).json({ error: "Operación denegada: No puedes registrar un pago porque la caja está cerrada." });
        
        res.status(500).json({ error: "Error interno del servidor al registrar al socio." });
    }
};


// LISTAR TODOS LOS SOCIOS 
export const listarSocios = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        const { search, estado } = req.query;

        let whereClause = { isDeleted: false };

        if (search) {
            whereClause.OR = [
                { nombreCompleto: { contains: search, mode: 'insensitive' } },
                { codigoSocio: { contains: search, mode: 'insensitive' } },
                { correo: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (estado && estado !== 'Todos') {
            whereClause.status = estado;
        }

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0); 
        const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const limite7Dias = new Date(hoy);
        limite7Dias.setDate(hoy.getDate() + 7);
        limite7Dias.setHours(23, 59, 59, 999);

        const [totalRecords, sociosRaw, sociosGlobalesStats] = await Promise.all([
            prisma.socio.count({ where: whereClause }),
            prisma.socio.findMany({ 
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    membresias: {
                        include: { plan: true },
                        orderBy: { fechaFin: 'desc' },
                        take: 1
                    },
                    contratos: {
                        orderBy: { fechaFin: 'desc' },
                        take: 1
                    }
                }
            }),
            prisma.socio.findMany({ 
                where: { isDeleted: false },
                select: {
                    createdAt: true,
                    membresias: {
                        select: { fechaFin: true, status: true },
                        orderBy: { fechaFin: 'desc' },
                        take: 1
                    }
                }
            })
        ]);

        let totalSocios = sociosGlobalesStats.length;
        let nuevosEsteMes = 0, activos = 0, vencidos = 0, vencenEn7Dias = 0;

        sociosGlobalesStats.forEach(socio => {
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

        const porcentajeActivos = totalSocios > 0 ? Math.round((activos / totalSocios) * 100) : 0;

        const dashboard_stats = {
            total_socios: { valor: totalSocios, etiqueta: `+${nuevosEsteMes} este mes` },
            socios_activos: { valor: activos, etiqueta: `${porcentajeActivos}% del total` },
            vencidos: { valor: vencidos, etiqueta: "Requieren seguimiento" },
            vencen_en_7_dias: { valor: vencenEn7Dias, etiqueta: "Renovación pendiente" }
        };

        const dataFormateada = sociosRaw.map(socio => {
            const membresiaActual = socio.membresias[0];
            const contratoActual = socio.contratos[0];

            return {
                socio_id: socio.id,
                clave: socio.codigoSocio,
                nombre: socio.nombreCompleto,
                genero: socio.genero || 'N/A',
                contacto: { telefono: socio.telefono, correo: socio.correo },
                membresia: membresiaActual ? membresiaActual.plan.nombre : 'Sin membresía',
                vencimiento: membresiaActual ? membresiaActual.fechaFin : null,
                vigencia: membresiaActual ? (new Date(membresiaActual.fechaFin) >= hoy ? 'Activa' : 'Vencida') : 'N/A',
                estado_pago: membresiaActual ? membresiaActual.estadoPago : 'N/A',
                estado_contrato: contratoActual ? (contratoActual.status === 'vigente') : false
            };
        });

        res.status(200).json({
            message: "Lista de socios obtenida correctamente",
            dashboard_stats: dashboard_stats, 
            data: dataFormateada,            
            pagination: { current_page: page, limit: limit, total_records: totalRecords, total_pages: Math.ceil(totalRecords / limit) }
        });

    } catch (error) {
        console.error("Error al listar socios:", error);
        res.status(500).json({ error: "Error interno al obtener la lista de socios." });
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
                membresias: { include: { plan: true }, orderBy: { fechaFin: 'desc' }, take: 1 },
                contratos: { orderBy: { fechaFin: 'desc' }, take: 1 }
            }
        });

        if (!socio || socio.isDeleted) {
            return res.status(404).json({ error: "Socio no encontrado." });
        }

        const membresiaActual = socio.membresias[0];
        const contratoActual = socio.contratos[0];
        const tieneContrato = !!contratoActual;

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        const dataFormateada = {
            codigo_socio: socio.codigoSocio,
            nombre_completo: socio.nombreCompleto,
            correo: socio.correo || 'Sin correo registrado',
            foto_perfil_url: socio.fotoUrl, 
            genero: socio.genero || 'N/A',
            telefono: socio.telefono || 'Sin teléfono',
            membresia: membresiaActual ? membresiaActual.plan.nombre : 'Sin membresía',
            vigencia_membresia: membresiaActual ? (new Date(membresiaActual.fechaFin) >= hoy ? 'Vigente' : 'Vencida') : 'N/A',
            estado_pago: membresiaActual ? membresiaActual.estadoPago : 'N/A',
            fecha_inicio_membresia: membresiaActual ? membresiaActual.fechaInicio : null, 
            fecha_fin_membresia: membresiaActual ? membresiaActual.fechaFin : null,      
            firmo_contrato: tieneContrato ? true : false,
            estado_contrato: contratoActual ? contratoActual.status : 'N/A',
            fecha_inicio_contrato: contratoActual ? contratoActual.fechaInicio : null, 
            fecha_fin_contrato: contratoActual ? contratoActual.fechaFin : null,       
            biometrico_rostro: socio.faceEncoding ? true : false,
            biometrico_huella: socio.huellaTemplate ? true : false,
            fecha_registro: socio.createdAt
        };

        res.status(200).json({ message: "Datos del socio obtenidos correctamente", data: dataFormateada });

    } catch (error) {
        console.error("Error al obtener socio:", error);
        res.status(500).json({ error: "Error interno al obtener los datos del socio." });
    }
};

// ACTUALIZAR SOCIO (PUT) - CON CONTABILIDAD DE DOBLE PARTIDA
export const actualizarSocio = async (req, res) => {
    try {
        const { id } = req.params;
        const { personal, biometria, detalles_contrato, membresia } = req.body;

        if (isNaN(id)) return res.status(400).json({ error: "ID de socio inválido." });
        const socioId = parseInt(id);

        const socioExistente = await prisma.socio.findUnique({ where: { id: socioId } });
        if (!socioExistente || socioExistente.isDeleted) return res.status(404).json({ error: "Socio no encontrado." });

        await prisma.$transaction(async (tx) => {
            
            // ACTUALIZAR DATOS PERSONALES Y BIOMETRÍA
            let dataSocio = {};
            if (personal) {
                if (personal.nombre_completo) dataSocio.nombreCompleto = personal.nombre_completo.trim();
                if (personal.correo_electronico !== undefined) dataSocio.correo = personal.correo_electronico;
                if (personal.numero_telefono !== undefined) dataSocio.telefono = personal.numero_telefono;
                if (personal.genero !== undefined) dataSocio.genero = personal.genero;
            }

            if (biometria) {
                if (biometria.foto_perfil_url !== undefined) dataSocio.fotoUrl = biometria.foto_perfil_url;
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
                    where: { socioId: socioId }, orderBy: { id: 'desc' }
                });

                if (detalles_contrato.contrato_firmado) {
                    const fInicioContrato = validarFecha(detalles_contrato.inicio_contrato, 'Inicio de Contrato');
                    const fFinContrato = validarFecha(detalles_contrato.fin_contrato, 'Fin de Contrato');
                    if(!fInicioContrato || !fFinContrato) throw new Error("UX_ERROR:Las fechas de contrato son requeridas.");

                    if (contratoActual) {
                        await tx.socioContrato.update({
                            where: { id: contratoActual.id },
                            data: {
                                fechaInicio: fInicioContrato,
                                fechaFin: fFinContrato,
                                status: 'vigente'
                            }
                        });
                    } else {
                        await tx.socioContrato.create({
                            data: {
                                uuidSocioContrato: crypto.randomUUID(),
                                socioId: socioId,
                                fechaInicio: fInicioContrato,
                                fechaFin: fFinContrato,
                                status: 'vigente',
                                createdBy: req.user.id
                            }
                        });
                    }
                } else if (contratoActual && !detalles_contrato.contrato_firmado) {
                    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
                    const fechaFinContrato = new Date(contratoActual.fechaFin); fechaFinContrato.setHours(0, 0, 0, 0);

                    if (contratoActual.status === 'vigente' && fechaFinContrato >= hoy) {
                        throw new Error("REGLA_CONTRATO_VIGENTE"); 
                    } else {
                        await tx.socioContrato.update({
                            where: { id: contratoActual.id }, data: { status: 'cancelado' }
                        });
                    }
                }
            }

            // ACTUALIZAR MEMBRESÍA CON LÓGICA CONTABLE (REVERSOS Y COBROS)
            if (membresia && membresia.plan_id) {
                const nuevoPlanId = parseInt(membresia.plan_id);
                const estadoPagoUI = membresia.estado_pago || 'sin_pagar';

                // Verificamos si hay una caja abierta por si necesitamos mover dinero
                const cajaAbierta = await tx.corteCaja.findFirst({ where: { status: 'abierto' } });

                const membresiaActual = await tx.membresiaSocio.findFirst({
                    where: { socioId: socioId }, orderBy: { id: 'desc' }
                });

                const planNuevo = await tx.membresiaPlan.findUnique({ where: { id: nuevoPlanId } });
                if (!planNuevo) throw new Error("NOT_FOUND:El plan de membresía seleccionado no existe.");

                const hoy = new Date();
                const esOfertaActiva = planNuevo.esOferta && planNuevo.fechaFinOferta && new Date(planNuevo.fechaFinOferta) >= hoy;
                const precioFinal = esOfertaActiva ? parseFloat(planNuevo.precioOferta) : parseFloat(planNuevo.precioBase);

                // --- AUTO-CÁLCULO DE FECHAS ---
                const fechaInicioReal = validarFecha(membresia.fecha_inicio, 'Inicio de Membresía');
                if(!fechaInicioReal) throw new Error("UX_ERROR:La fecha de inicio de membresía es requerida.");

                let fechaFinReal;
                if (membresia.fecha_vencimiento) {
                    fechaFinReal = validarFecha(membresia.fecha_vencimiento, 'Fin de Membresía');
                } else {
                    fechaFinReal = new Date(fechaInicioReal);
                    fechaFinReal.setDate(fechaFinReal.getDate() + planNuevo.duracionDias);
                }

                const metodoPagoIdValido = await validarMetodoPago(tx, membresia.metodo_pago_id);

                const registrarCobro = async (membresiaId, monto, nota) => {
                    if (monto <= 0) return; // 🔥 ESCUDO: No registrar cobros de $0
                    if (!cajaAbierta) throw new Error("CAJA_CERRADA");
                    
                    await tx.pagoMembresia.create({
                        data: {
                            membresiaSocioId: membresiaId,
                            metodoPagoId: metodoPagoIdValido,
                            monto: monto,
                            recibidoPor: req.user.id
                        }
                    });

                    let conceptoMembresia = await tx.concepto.findFirst({ where: { nombre: 'Inscripción / Membresía' } });
                    if (!conceptoMembresia) conceptoMembresia = await tx.concepto.create({ data: { nombre: 'Inscripción / Membresía', tipo: 'ingreso' } });

                    await tx.cajaMovimiento.create({
                        data: {
                            corteId: cajaAbierta.id, usuarioId: req.user.id, conceptoId: conceptoMembresia.id,
                            tipo: 'ingreso', monto: monto, referenciaTipo: 'membresia', referenciaId: membresiaId, nota: nota
                        }
                    });
                };

                const registrarReverso = async (membresiaId, monto, nota) => {
                    if (monto <= 0) return; // No registrar reversos de $0
                    if (!cajaAbierta) throw new Error("CAJA_CERRADA");

                    // TRAZABILIDAD: Crear el espejo negativo en los pagos de la membresía
                    await tx.pagoMembresia.create({
                        data: {
                            membresiaSocioId: membresiaId,
                            metodoPagoId: metodoPagoIdValido, 
                            monto: -Math.abs(monto), // Forzamos el monto a negativo
                            recibidoPor: req.user.id
                        }
                    });

                    // CAJA: Registrar la salida física del dinero
                    let conceptoDevolucion = await tx.concepto.findFirst({ where: { nombre: 'Devolución de Membresía' } });
                    if (!conceptoDevolucion) conceptoDevolucion = await tx.concepto.create({ data: { nombre: 'Devolución de Membresía', tipo: 'gasto' } });

                    await tx.cajaMovimiento.create({
                        data: {
                            corteId: cajaAbierta.id, 
                            usuarioId: req.user.id, 
                            conceptoId: conceptoDevolucion.id,
                            tipo: 'gasto', 
                            monto: Math.abs(monto), 
                            referenciaTipo: 'membresia', 
                            referenciaId: membresiaId, 
                            nota: nota
                        }
                    });
                };

                if (membresiaActual) {
                    const estadoAnterior = membresiaActual.estadoPago;
                    const precioAnterior = parseFloat(membresiaActual.precioCongelado || 0);

                    // CASO A: CAMBIO DE PLAN 
                    if (membresiaActual.planId !== nuevoPlanId) {
                        
                        // 1. Si la anterior estaba pagada, DEVOLVEMOS el dinero contablemente
                        if (estadoAnterior === 'pagado') {
                            await registrarReverso(membresiaActual.id, precioAnterior, `Reverso por cambio de plan. Socio: ${socioExistente.codigoSocio}`);
                        }

                        // 2. Cancelamos la vieja
                        await tx.membresiaSocio.update({
                            where: { id: membresiaActual.id },
                            data: { status: 'cancelada' }
                        });

                        // 3. Creamos la nueva
                        const nuevaMembresia = await tx.membresiaSocio.create({
                            data: {
                                uuidMembresiaSocio: crypto.randomUUID(), socioId: socioId, planId: nuevoPlanId,
                                fechaInicio: fechaInicioReal,fechaFin: fechaFinReal,
                                status: 'activa', estadoPago: estadoPagoUI, precioCongelado: precioFinal, asignadoPor: req.user.id
                            }
                        });

                        // 4. Cobramos la nueva (si el UI la mandó como pagada)
                        if (estadoPagoUI === 'pagado') {
                            await registrarCobro(nuevaMembresia.id, precioFinal, `Cobro de nuevo plan. Socio: ${socioExistente.codigoSocio}`);
                        }
                    } 
                    // CASO B: MISMO PLAN, SOLO CAMBIARON FECHAS O ESTADO DE PAGO
                    else {
                        await tx.membresiaSocio.update({
                            where: { id: membresiaActual.id },
                            data: {
                                fechaInicio: fechaInicioReal, 
                                fechaFin: fechaFinReal,       
                                estadoPago: estadoPagoUI
                            }
                        });

                        // Respaldamos el monto: Si el precio anterior era 0 (error de datos viejos), usamos el precio del plan actual.
                        const montoOperacion = precioAnterior > 0 ? precioAnterior : precioFinal;

                        // Si debía el plan y ahora lo pagan
                        if (estadoAnterior === 'sin_pagar' && estadoPagoUI === 'pagado') {
                            await registrarCobro(membresiaActual.id, montoOperacion, `Pago atrasado de membresía. Socio: ${socioExistente.codigoSocio}`);
                        } 
                        // Si estaba pagado y se equivocaron (lo regresan a sin pagar)
                        else if (estadoAnterior === 'pagado' && estadoPagoUI === 'sin_pagar') {
                            await registrarReverso(membresiaActual.id, montoOperacion, `Corrección: Membresía a 'Sin Pagar'. Socio: ${socioExistente.codigoSocio}`);
                        }
                    }
                } else {
                    // CASO C: NO TENÍA MEMBRESÍA
                    const nuevaMembresia = await tx.membresiaSocio.create({
                        data: {
                            uuidMembresiaSocio: crypto.randomUUID(), socioId: socioId, planId: nuevoPlanId,
                            fechaInicio: fechaInicioReal, fechaFin: fechaFinReal,
                            status: 'activa', estadoPago: estadoPagoUI, precioCongelado: precioFinal, asignadoPor: req.user.id
                        }
                    });

                    if (estadoPagoUI === 'pagado') {
                        await registrarCobro(nuevaMembresia.id, precioFinal, `Suscripción de membresía asignada. Socio: ${socioExistente.codigoSocio}`);
                    }
                }
            }
        }, {
            maxWait: 5000,
            timeout: 20000 
        });

        res.status(200).json({ message: "Perfil del socio actualizado correctamente." });

    } catch (error) {
        console.error("Error al actualizar socio:", error);
        
        // Manejo de Errores UX mejorado (Evita los 500 genéricos)
        if (error.message.startsWith("UX_ERROR:")) return res.status(400).json({ error: error.message.replace("UX_ERROR:", "") });
        if (error.message.startsWith("NOT_FOUND:")) return res.status(404).json({ error: error.message.replace("NOT_FOUND:", "") });
        if (error.message === "CAJA_CERRADA") return res.status(403).json({ error: "Operación denegada: La actualización requiere registrar un pago o devolución, pero la caja está cerrada." });
        if (error.message === "REGLA_CONTRATO_VIGENTE") return res.status(400).json({ error: "No se puede desactivar el contrato porque aún se encuentra vigente." });

        res.status(500).json({ error: "Error interno al actualizar el perfil del socio." });
    }
};

// ELIMINAR SOCIO (Borrado Lógico)
export const eliminarSocio = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) return res.status(400).json({ error: "ID de socio inválido." });
        
        const socioId = parseInt(id);

        const socioExistente = await prisma.socio.findUnique({
            where: { id: socioId },
            include: {
                membresias: { where: { status: 'activa' } },
                contratos: { where: { status: 'vigente' } }
            }
        });

        if (!socioExistente || socioExistente.isDeleted) {
            return res.status(404).json({ error: "Socio no encontrado o ya fue eliminado." });
        }

        await prisma.$transaction(async (tx) => {
            await tx.socio.update({
                where: { id: socioId },
                data: { isDeleted: true, status: 'inactivo' }
            });

            if (socioExistente.membresias.length > 0) {
                await tx.membresiaSocio.update({
                    where: { id: socioExistente.membresias[0].id },
                    data: { status: 'cancelada' }
                });
            }

            if (socioExistente.contratos.length > 0) {
                await tx.socioContrato.update({
                    where: { id: socioExistente.contratos[0].id },
                    data: { status: 'cancelado' }
                });
            }
        });

        await registrarLog({
        req,
        accion: 'eliminar',
        modulo: 'socios',
        registroId: socioId,
        detalles: `Socio dado de baja del gimnasio`
    });

        res.status(200).json({ message: "Socio eliminado correctamente del sistema." });

    } catch (error) {
        console.error("Error al eliminar socio:", error);
        res.status(500).json({ error: "Error interno al intentar eliminar al socio." });
    }
};


// 6. HISTORIAL DE MEMBRESÍAS Y PAGOS
export const obtenerHistorialMembresias = async (req, res) => {
    try {
        const socioId = parseInt(req.params.id);
        if (isNaN(socioId)) return res.status(400).json({ error: "ID de socio inválido." });

        const socio = await prisma.socio.findUnique({
            where: { id: socioId },
            select: { id: true, nombreCompleto: true, codigoSocio: true }
        });

        if (!socio) return res.status(404).json({ error: "Socio no encontrado." });

        const membresias = await prisma.membresiaSocio.findMany({
            where: { socioId: socioId },
            orderBy: { fechaInicio: 'desc' },
            include: {
                plan: { select: { nombre: true, duracionDias: true } },
                pagos: {
                    include: {
                        metodoPago: { select: { nombre: true } },
                        cobrador: { select: { nombreCompleto: true } }
                    }
                },
                usuarioAsigna: { select: { nombreCompleto: true } }
            }
        });

        const dataFormateada = membresias.map(m => ({
            id_membresia_socio: m.id,
            plan: m.plan.nombre,
            fecha_inicio: m.fechaInicio,
            fecha_fin: m.fechaFin,
            status_vigencia: m.status, // activa, vencida, cancelada
            estado_pago: m.estadoPago, // pagado, sin_pagar
            precio_cobrado: m.precioCongelado,
            asignado_por: m.usuarioAsigna?.nombreCompleto || 'Sistema',
            pagos: m.pagos.map(p => ({
                id_pago: p.id,
                monto: p.monto,
                metodo_pago: p.metodoPago.nombre,
                fecha_pago: p.pagadoEn,
                recibido_por: p.cobrador?.nombreCompleto || 'Sistema'
            }))
        }));

        res.status(200).json({
            message: "Historial obtenido exitosamente",
            data: { socio, historial: dataFormateada }
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
        const { membresia_socio_id, metodo_pago_id } = req.body; // membresia_socio_id ahora es opcional

        if (isNaN(socioId)) {
            return res.status(400).json({ error: "Faltan datos obligatorios." });
        }

        await prisma.$transaction(async (tx) => {
            const cajaAbierta = await tx.corteCaja.findFirst({ where: { status: 'abierto' } });
            if (!cajaAbierta) throw new Error("CAJA_CERRADA");

            let membresia;

            // CASO A: El Front manda el ID específico a pagar
            if (membresia_socio_id) {
                membresia = await tx.membresiaSocio.findUnique({ 
                    where: { id: parseInt(membresia_socio_id) }, 
                    include: { socio: true } 
                });
                if (!membresia) throw new Error("NOT_FOUND:La membresía no existe.");
                if (membresia.socioId !== socioId) throw new Error("UX_ERROR:La membresía no pertenece a este socio. Verifica no estar enviando el plan_id.");
            } 
            // CASO B: El Front no manda ID, buscamos la deuda automáticamente
            else {
                membresia = await tx.membresiaSocio.findFirst({
                    where: { socioId: socioId, estadoPago: 'sin_pagar' },
                    orderBy: { fechaInicio: 'desc' }, // Tomamos la más reciente
                    include: { socio: true }
                });
                if (!membresia) throw new Error("UX_ERROR:Este socio no tiene membresías pendientes de pago.");
            }

            if (membresia.estadoPago === 'pagado') throw new Error("UX_ERROR:Esta membresía ya se encuentra pagada.");

            const metodoPagoIdValido = await validarMetodoPago(tx, metodo_pago_id);

            // 1. Crear el recibo de pago
            await tx.pagoMembresia.create({
                data: {
                    membresiaSocioId: membresia.id,
                    metodoPagoId: metodoPagoIdValido,
                    monto: membresia.precioCongelado,
                    recibidoPor: req.user.id
                }
            });

            // 2. Ingresar el dinero a la caja
            let concepto = await tx.concepto.findFirst({ where: { nombre: 'Inscripción / Membresía' } });
            if (!concepto) concepto = await tx.concepto.create({ data: { nombre: 'Inscripción / Membresía', tipo: 'ingreso' } });

            await tx.cajaMovimiento.create({
                data: {
                    corteId: cajaAbierta.id,
                    usuarioId: req.user.id,
                    conceptoId: concepto.id,
                    tipo: 'ingreso',
                    monto: membresia.precioCongelado,
                    referenciaTipo: 'membresia',
                    referenciaId: membresia.id,
                    nota: `Pago de membresía atrasada. Socio: ${membresia.socio.codigoSocio}`
                }
            });

            // 3. Actualizar el estatus a PAGADO
            await tx.membresiaSocio.update({
                where: { id: membresia.id },
                data: { estadoPago: 'pagado' }
            });
        });

        await registrarLog({
            req,
            accion: 'pagar',
            modulo: 'socios',
            registroId: socioId, // ID del socio
            detalles: `Se procesó un pago de membresía pendiente`
        });

        res.status(200).json({ message: "Pago registrado correctamente en caja." });

    } catch (error) {
        console.error("Error al pagar membresía:", error);
        if (error.message.startsWith("UX_ERROR:")) return res.status(400).json({ error: error.message.replace("UX_ERROR:", "") });
        if (error.message.startsWith("NOT_FOUND:")) return res.status(404).json({ error: error.message.replace("NOT_FOUND:", "") });
        if (error.message === "CAJA_CERRADA") return res.status(403).json({ error: "No puedes registrar el pago porque la caja está cerrada." });
        res.status(500).json({ error: "Error interno al procesar el pago." });
    }
};

// 8. RENOVAR MEMBRESÍA (Crear nuevo ciclo)
export const renovarMembresia = async (req, res) => {
    try {
        const socioId = parseInt(req.params.id);
        const { plan_id, metodo_pago_id, fecha_inicio } = req.body;

        if (isNaN(socioId) || !plan_id) {
            return res.status(400).json({ error: "El socio y el plan son obligatorios para renovar." });
        }

        await prisma.$transaction(async (tx) => {
            const socio = await tx.socio.findUnique({ where: { id: socioId, isDeleted: false } });
            if (!socio) throw new Error("NOT_FOUND:Socio no encontrado.");

            const cajaAbierta = await tx.corteCaja.findFirst({ where: { status: 'abierto' } });
            if (!cajaAbierta) throw new Error("CAJA_CERRADA");

            const plan = await tx.membresiaPlan.findUnique({ where: { id: parseInt(plan_id) } });
            if (!plan) throw new Error("NOT_FOUND:El plan seleccionado no existe.");

            // Lógica inteligente de fechas: 
            // Si el front manda una fecha, la usamos. Si no, arranca hoy.
            const fechaInicioReal = fecha_inicio ? validarFecha(fecha_inicio, 'Inicio de Renovación') : new Date();
            const fechaFinReal = new Date(fechaInicioReal);
            fechaFinReal.setDate(fechaFinReal.getDate() + plan.duracionDias);

            // Calcular ofertas
            const hoy = new Date();
            const esOfertaActiva = plan.esOferta && plan.fechaFinOferta && new Date(plan.fechaFinOferta) >= hoy;
            const precioFinal = esOfertaActiva ? plan.precioOferta : plan.precioBase;

            // 1. Crear nueva membresía
            const nuevaMembresia = await tx.membresiaSocio.create({
                data: {
                    uuidMembresiaSocio: crypto.randomUUID(),
                    socioId: socio.id,
                    planId: plan.id,
                    fechaInicio: fechaInicioReal,
                    fechaFin: fechaFinReal,
                    status: 'activa',
                    estadoPago: 'pagado', // Asumimos que la renovación se paga en el momento
                    precioCongelado: precioFinal,
                    asignadoPor: req.user.id
                }
            });

            // 2. Registrar pago y movimiento de caja
            const metodoPagoIdValido = await validarMetodoPago(tx, metodo_pago_id);

            await tx.pagoMembresia.create({
                data: {
                    membresiaSocioId: nuevaMembresia.id,
                    metodoPagoId: metodoPagoIdValido,
                    monto: precioFinal,
                    recibidoPor: req.user.id
                }
            });

            let concepto = await tx.concepto.findFirst({ where: { nombre: 'Renovación de Membresía' } });
            if (!concepto) concepto = await tx.concepto.create({ data: { nombre: 'Renovación de Membresía', tipo: 'ingreso' } });

            await tx.cajaMovimiento.create({
                data: {
                    corteId: cajaAbierta.id,
                    usuarioId: req.user.id,
                    conceptoId: concepto.id,
                    tipo: 'ingreso',
                    monto: precioFinal,
                    referenciaTipo: 'membresia',
                    referenciaId: nuevaMembresia.id,
                    nota: `Renovación de socio ${socio.codigoSocio} - Plan: ${plan.nombre}`
                }
            });
        });

        await registrarLog({
            req,
            accion: 'renovar',
            modulo: 'socios',
            registroId: socioId,
            detalles: `Se renovó la membresía del socio`
        });

        res.status(201).json({ message: "Membresía renovada y cobrada exitosamente." });

    } catch (error) {
        console.error("Error al renovar:", error);
        if (error.message.startsWith("UX_ERROR:")) return res.status(400).json({ error: error.message.replace("UX_ERROR:", "") });
        if (error.message.startsWith("NOT_FOUND:")) return res.status(404).json({ error: error.message.replace("NOT_FOUND:", "") });
        if (error.message === "CAJA_CERRADA") return res.status(403).json({ error: "No puedes renovar porque la caja está cerrada." });
        res.status(500).json({ error: "Error interno al procesar la renovación." });
    }
};