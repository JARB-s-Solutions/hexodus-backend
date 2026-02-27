import prisma from "../config/prisma.js";
import crypto from "crypto";

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
            return res.status(404).json({ error: "Plan no encontrado." });
        }

        // Calcular Fechas
        const inicio = new Date(fecha_inicio);
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
        const {
            personal,
            biometria,
            detalles_contrato,
            membresia
        } = req.body;

        if (!personal || !personal.nombre_completo || !personal.genero) {
            return res.status(400).json({ error: "El Nombre Completo y Género son obligatorios." });
        }

        const partesNombre = personal.nombre_completo.trim().split(" ");
        const nombre = partesNombre[0];
        const apellidoPaterno = partesNombre.length > 1 ? partesNombre.slice(1).join(" ") : "Sin Apellidos";

        const resultadoTransaccion = await prisma.$transaction(async (tx) => {
            
            // A) CREAR SOCIO Y BIOMETRÍA ---
            const nuevoSocio = await tx.socio.create({
                data: {
                    uuidSocio: crypto.randomUUID(),
                    codigoSocio: `SOC-${Date.now().toString().slice(-6)}`,
                    nombre: nombre,
                    apellidoPaterno: apellidoPaterno,
                    correo: personal.correo_electronico || null,
                    telefono: personal.numero_telefono || null,
                    genero: personal.genero,
                    createdBy: req.user.id,
                    fotoUrl: biometria?.foto_perfil_url || null,
                    faceEncoding: biometria?.face_encoding || null,
                    faceEncodingUpdatedAt: biometria?.face_encoding_updated_at ? new Date(biometria.face_encoding_updated_at) : null,
                    huellaTemplate: biometria?.fingerprint_template || null,
                    huellaUpdatedAt: biometria?.fingerprint_updated_at ? new Date(biometria.fingerprint_updated_at) : null,
                }
            });

            // B) CONTRATO ---
            if (detalles_contrato && detalles_contrato.contrato_firmado) {
                await tx.socioContrato.create({
                    data: {
                        uuidSocioContrato: crypto.randomUUID(),
                        socioId: nuevoSocio.id,
                        fechaInicio: new Date(detalles_contrato.inicio_contrato),
                        fechaFin: new Date(detalles_contrato.fin_contrato),
                        status: 'vigente',
                        createdBy: req.user.id
                    }
                });
            }

            // C) ASIGNAR MEMBRESÍA (Con o Sin Cobro en Caja) ---
            if (membresia && membresia.plan_id) {
                const plan = await tx.membresiaPlan.findUnique({ where: { id: parseInt(membresia.plan_id) } });
                if (!plan) throw new Error("El plan de membresía seleccionado no existe.");

                const fechaInicio = new Date(membresia.fecha_inicio);
                let fechaFin = membresia.fecha_vencimiento ? new Date(membresia.fecha_vencimiento) : new Date(fechaInicio);
                if (!membresia.fecha_vencimiento) {
                    fechaFin.setDate(fechaFin.getDate() + plan.duracionDias);
                }

                const hoy = new Date();
                const esOfertaActiva = plan.esOferta && plan.fechaFinOferta && new Date(plan.fechaFinOferta) >= hoy;
                const precioFinal = esOfertaActiva ? plan.precioOferta : plan.precioBase;

                // ¿El cajero decidió cobrar o dejar pendiente?
                const estadoPagoUI = membresia.estado_pago || 'pagado'; // 'pagado' o 'sin_pagar'

                const membresiaAsignada = await tx.membresiaSocio.create({
                    data: {
                        uuidMembresiaSocio: crypto.randomUUID(),
                        socioId: nuevoSocio.id,
                        planId: plan.id,
                        fechaInicio: fechaInicio,
                        fechaFin: fechaFin,
                        status: 'activa',
                        estadoPago: estadoPagoUI, // Se guarda como pagado o pendiente
                        precioCongelado: precioFinal,
                        asignadoPor: req.user.id
                    }
                });

                // Si se marcó como "pagado", hacemos la entrada de dinero
                if (estadoPagoUI === 'pagado') {
                    await tx.pagoMembresia.create({
                        data: {
                            membresiaSocioId: membresiaAsignada.id,
                            metodoPagoId: membresia.metodo_pago_id || 1, 
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
        if (error.message === "El plan de membresía seleccionado no existe.") {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Error interno del servidor al registrar al socio." });
    }
};


// LISTAR TODOS LOS SOCIOS (Con KPIs Globales y Optimizado para Tabla)
export const listarSocios = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        const { search, estado } = req.query;

        // Filtros para la tabla
        let whereClause = {
            isDeleted: false
        };

        if (search) {
            whereClause.OR = [
                { nombre: { contains: search, mode: 'insensitive' } },
                { apellidoPaterno: { contains: search, mode: 'insensitive' } },
                { codigoSocio: { contains: search, mode: 'insensitive' } },
                { correo: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (estado && estado !== 'Todos') {
            whereClause.status = estado;
        }

        // Tiempos exactos para cálculos de vigencia
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0); // Inicio de hoy
        
        const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        
        const limite7Dias = new Date(hoy);
        limite7Dias.setDate(hoy.getDate() + 7);
        limite7Dias.setHours(23, 59, 59, 999);

        // Ejecución Paralela: Buscamos totales, tabla y datos globales para las tarjetas
        const [totalRecords, sociosRaw, sociosGlobalesStats] = await Promise.all([
            prisma.socio.count({ where: whereClause }), // Para paginación
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
            prisma.socio.findMany({ // Consulta ultra ligera de TODOS los socios para las estadísticas
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

        // --- CÁLCULO DE LAS 4 TARJETAS DEL DASHBOARD ---
        let totalSocios = sociosGlobalesStats.length;
        let nuevosEsteMes = 0;
        let activos = 0;
        let vencidos = 0;
        let vencenEn7Dias = 0;

        sociosGlobalesStats.forEach(socio => {
            // Tarjeta 1: Nuevos este mes
            if (socio.createdAt >= inicioMes) nuevosEsteMes++;

            if (socio.membresias.length > 0) {
                const fechaFin = new Date(socio.membresias[0].fechaFin);

                if (fechaFin >= hoy) {
                    // Tarjeta 2: Activos
                    activos++;
                    // Tarjeta 4: Vencen en 7 días
                    if (fechaFin <= limite7Dias) vencenEn7Dias++;
                } else {
                    // Tarjeta 3: Vencidos
                    vencidos++;
                }
            } else {
                // Si nunca compró membresía, cuenta como inactivo/vencido
                vencidos++;
            }
        });

        // Calcular porcentaje para Tarjeta 2
        const porcentajeActivos = totalSocios > 0 ? Math.round((activos / totalSocios) * 100) : 0;

        const dashboard_stats = {
            total_socios: {
                valor: totalSocios,
                etiqueta: `+${nuevosEsteMes} este mes`
            },
            socios_activos: {
                valor: activos,
                etiqueta: `${porcentajeActivos}% del total`
            },
            vencidos: {
                valor: vencidos,
                etiqueta: "Requieren seguimiento"
            },
            vencen_en_7_dias: {
                valor: vencenEn7Dias,
                etiqueta: "Renovación pendiente"
            }
        };

        // --- FORMATEO DE LA TABLA ---
        const dataFormateada = sociosRaw.map(socio => {
            const membresiaActual = socio.membresias[0];
            const contratoActual = socio.contratos[0];

            return {
                socio_id: socio.id,
                clave: socio.codigoSocio,
                nombre: `${socio.nombre} ${socio.apellidoPaterno}`.trim(),
                genero: socio.genero || 'N/A',
                contacto: {
                    telefono: socio.telefono,
                    correo: socio.correo
                },
                membresia: membresiaActual ? membresiaActual.plan.nombre : 'Sin membresía',
                vencimiento: membresiaActual ? membresiaActual.fechaFin : null,
                // Validamos en tiempo real si sigue activa hoy
                vigencia: membresiaActual ? (new Date(membresiaActual.fechaFin) >= hoy ? 'Activa' : 'Vencida') : 'N/A',
                estado_contrato: contratoActual ? contratoActual.status : 'Sin contrato'
            };
        });

        res.status(200).json({
            message: "Lista de socios obtenida correctamente",
            dashboard_stats: dashboard_stats, 
            data: dataFormateada,            
            pagination: {
                current_page: page,
                limit: limit,
                total_records: totalRecords,
                total_pages: Math.ceil(totalRecords / limit)
            }
        });

    } catch (error) {
        console.error("Error al listar socios:", error);
        res.status(500).json({ error: "Error interno al obtener la lista de socios." });
    }
};

// OBTENER UN SOCIO EN ESPECÍFICO (Optimizado para el Modal de Detalle)
export const obtenerSocio = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de socio inválido." });
        }

        const socio = await prisma.socio.findUnique({
            where: { id: parseInt(id) },
            include: {
                // Traemos la membresía actual para el campo "Membresía:"
                membresias: {
                    include: { plan: true },
                    orderBy: { fechaFin: 'desc' },
                    take: 1
                },
                // Traemos el contrato para saber si "Firmó Contrato:"
                contratos: {
                    orderBy: { fechaFin: 'desc' },
                    take: 1
                }
            }
        });

        if (!socio || socio.isDeleted) {
            return res.status(404).json({ error: "Socio no encontrado." });
        }

        const membresiaActual = socio.membresias[0];
        const tieneContrato = socio.contratos.length > 0;

        // Formatear la respuesta
        const dataFormateada = {
            // Header del Modal
            id: socio.id,
            nombre_completo: `${socio.nombre} ${socio.apellidoPaterno}`.trim(),
            correo: socio.correo || 'Sin correo registrado',
            foto_perfil_url: socio.fotoUrl, 
            
            // Cuerpo del Modal
            genero: socio.genero || 'N/A',
            telefono: socio.telefono || 'Sin teléfono',
            membresia: membresiaActual ? membresiaActual.plan.nombre : 'Sin membresía',
            firmo_contrato: tieneContrato, // true o false
            
            // Biométricos
            biometrico_rostro: socio.faceEncoding ? true : false,
            biometrico_huella: socio.huellaTemplate ? true : false,
            
            // Footer
            fecha_registro: socio.createdAt
        };

        res.status(200).json({
            message: "Datos del socio obtenidos correctamente",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al obtener socio:", error);
        res.status(500).json({ error: "Error interno al obtener los datos del socio." });
    }
};


// ACTUALIZAR SOCIO (PUT)
export const actualizarSocio = async (req, res) => {
    try {
        const { id } = req.params;
        const { personal, biometria, detalles_contrato, membresia } = req.body;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de socio inválido." });
        }

        const socioId = parseInt(id);

        // Verificar si el socio existe
        const socioExistente = await prisma.socio.findUnique({
            where: { id: socioId }
        });

        if (!socioExistente || socioExistente.isDeleted) {
            return res.status(404).json({ error: "Socio no encontrado." });
        }

        // Transacción Maestra para actualizar todas las tablas
        await prisma.$transaction(async (tx) => {
            
            // ACTUALIZAR DATOS PERSONALES Y BIOMETRÍA
            let dataSocio = {};
            
            if (personal) {
                if (personal.nombre_completo) {
                    const partesNombre = personal.nombre_completo.trim().split(" ");
                    dataSocio.nombre = partesNombre[0];
                    dataSocio.apellidoPaterno = partesNombre.length > 1 ? partesNombre.slice(1).join(" ") : "Sin Apellidos";
                }
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

            // Solo hacemos el update si hay campos que cambiar
            if (Object.keys(dataSocio).length > 0) {
                await tx.socio.update({
                    where: { id: socioId },
                    data: dataSocio
                });
            }

            // CONTRATO
            if (detalles_contrato) {
                // Buscamos su contrato más reciente
                const contratoActual = await tx.socioContrato.findFirst({
                    where: { socioId: socioId },
                    orderBy: { id: 'desc' }
                });

                if (detalles_contrato.contrato_firmado) {
                    if (contratoActual) {
                        // Actualizar fechas del existente
                        await tx.socioContrato.update({
                            where: { id: contratoActual.id },
                            data: {
                                fechaInicio: new Date(detalles_contrato.inicio_contrato),
                                fechaFin: new Date(detalles_contrato.fin_contrato),
                                status: 'vigente'
                            }
                        });
                    } else {
                        // Si no tenía contrato y lo acaban de encender en el UI
                        await tx.socioContrato.create({
                            data: {
                                uuidSocioContrato: crypto.randomUUID(),
                                socioId: socioId,
                                fechaInicio: new Date(detalles_contrato.inicio_contrato),
                                fechaFin: new Date(detalles_contrato.fin_contrato),
                                status: 'vigente',
                                createdBy: req.user.id
                            }
                        });
                    }
                } else if (contratoActual && !detalles_contrato.contrato_firmado) {
                    // Si el switch está apagado pero sí tenía contrato, lo cancelamos
                    await tx.socioContrato.update({
                        where: { id: contratoActual.id },
                        data: { status: 'cancelado' }
                    });
                }
            }

            // MEMBRESÍA
            if (membresia && membresia.plan_id) {
                // Buscamos su membresía más reciente
                const membresiaActual = await tx.membresiaSocio.findFirst({
                    where: { socioId: socioId },
                    orderBy: { id: 'desc' }
                });

                if (membresiaActual) {
                    // Si ya tenía membresía, solo actualizamos los datos
                    await tx.membresiaSocio.update({
                        where: { id: membresiaActual.id },
                        data: {
                            planId: parseInt(membresia.plan_id),
                            fechaInicio: new Date(membresia.fecha_inicio),
                            fechaFin: new Date(membresia.fecha_vencimiento)
                        }
                    });
                } else {
                    // Si no tenía membresía, se la creamos desde aquí
                    const plan = await tx.membresiaPlan.findUnique({
                        where: { id: parseInt(membresia.plan_id) }
                    });

                    if (plan) {
                        await tx.membresiaSocio.create({
                            data: {
                                uuidMembresiaSocio: crypto.randomUUID(),
                                socioId: socioId,
                                planId: plan.id,
                                fechaInicio: new Date(membresia.fecha_inicio),
                                fechaFin: new Date(membresia.fecha_vencimiento),
                                status: 'activa',
                                estadoPago: membresia.estado_pago || 'sin_pagar',
                                precioCongelado: plan.precioBase,
                                asignadoPor: req.user.id
                            }
                        });
                    }
                }
            }
        }, {
            maxWait: 5000,  // Espera hasta 5 segundos para que la BD esté libre
            timeout: 20000  // Le damos 20 segundos a la transacción en lugar de 5
        });

        res.status(200).json({
            message: "Perfil del socio actualizado correctamente."
        });

    } catch (error) {
        console.error("Error al actualizar socio:", error);
        res.status(500).json({ error: "Error interno al actualizar el perfil del socio." });
    }
};