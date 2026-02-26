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
                    direccion: personal.direccion || null,
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