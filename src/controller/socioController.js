import prisma from "../config/prisma.js";
import crypto from "crypto";

// CREAR SOCIO + BIOMETRÍA DUAL + CONTRATO + MEMBRESÍA
export const crearSocio = async (req, res) => {
    try {
        const {
            personal,
            biometria,
            detalles_contrato,
            membresia
        } = req.body;

        // Validaciones básicas obligatorias
        if (!personal || !personal.nombre_completo || !personal.genero) {
            return res.status(400).json({ error: "El Nombre Completo y Género son obligatorios." });
        }

        // Lógica para separar "Nombre Completo" en Nombre y Apellido (Requisito de la BD)
        const partesNombre = personal.nombre_completo.trim().split(" ");
        const nombre = partesNombre[0];
        const apellidoPaterno = partesNombre.length > 1 ? partesNombre.slice(1).join(" ") : "Sin Apellidos";

        // Transacción
        const resultadoTransaccion = await prisma.$transaction(async (tx) => {
            
            // --- A) CREAR EL SOCIO Y SU BIOMETRÍA ---
            const nuevoSocio = await tx.socio.create({
                data: {
                    uuidSocio: crypto.randomUUID(),
                    codigoSocio: `SOC-${Date.now().toString().slice(-6)}`, // Genera ej. SOC-123456
                    nombre: nombre,
                    apellidoPaterno: apellidoPaterno,
                    correo: personal.correo_electronico || null,
                    telefono: personal.numero_telefono || null,
                    genero: personal.genero,
                    direccion: personal.direccion || null,
                    createdBy: req.user.id, // Del JWT

                    // Biometría Facial
                    fotoUrl: biometria?.foto_perfil_url || null,
                    faceEncoding: biometria?.face_encoding || null,
                    faceEncodingUpdatedAt: biometria?.face_encoding_updated_at ? new Date(biometria.face_encoding_updated_at) : null,
                    
                    // Biometría Huella
                    huellaTemplate: biometria?.fingerprint_template || null,
                    huellaUpdatedAt: biometria?.fingerprint_updated_at ? new Date(biometria.fingerprint_updated_at) : null,
                }
            });

            // --- B) REGISTRAR CONTRATO FIRMADO ---
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

            // --- C) ASIGNAR MEMBRESÍA Y COBRAR (Si se seleccionó una) ---
            if (membresia && membresia.plan_id) {
                // Consultar el plan para obtener precio y duración
                const plan = await tx.membresiaPlan.findUnique({
                    where: { id: parseInt(membresia.plan_id) }
                });

                if (!plan) throw new Error("El plan de membresía seleccionado no existe.");

                const fechaInicio = new Date(membresia.fecha_inicio);
                // Si el UI manda vencimiento lo usamos, si no, lo calculamos
                let fechaFin = membresia.fecha_vencimiento ? new Date(membresia.fecha_vencimiento) : new Date(fechaInicio);
                if (!membresia.fecha_vencimiento) {
                    fechaFin.setDate(fechaFin.getDate() + plan.duracionDias);
                }

                // Determinar precio real (Si hay oferta activa)
                const hoy = new Date();
                const esOfertaActiva = plan.esOferta && plan.fechaFinOferta && new Date(plan.fechaFinOferta) >= hoy;
                const precioFinal = esOfertaActiva ? plan.precioOferta : plan.precioBase;

                // Crear la asignación
                const membresiaAsignada = await tx.membresiaSocio.create({
                    data: {
                        uuidMembresiaSocio: crypto.randomUUID(),
                        socioId: nuevoSocio.id,
                        planId: plan.id,
                        fechaInicio: fechaInicio,
                        fechaFin: fechaFin,
                        status: 'activa',
                        estadoPago: 'pagado',
                        precioCongelado: precioFinal,
                        asignadoPor: req.user.id
                    }
                });

                // Registrar el pago en historial
                await tx.pagoMembresia.create({
                    data: {
                        membresiaSocioId: membresiaAsignada.id,
                        metodoPagoId: membresia.metodo_pago_id || 1, // Por defecto Efectivo
                        monto: precioFinal,
                        recibidoPor: req.user.id
                    }
                });

                // --- D) REGISTRO EN CAJA CONTABLE ---
                // Buscamos el concepto de "Ingreso por Membresía"
                let conceptoMembresia = await tx.concepto.findFirst({
                    where: { nombre: 'Inscripción / Membresía' }
                });
                
                // Si no existe, creamos uno genérico de rescate
                if (!conceptoMembresia) {
                    conceptoMembresia = await tx.concepto.create({
                        data: { nombre: 'Inscripción / Membresía', tipo: 'ingreso' }
                    });
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

            return nuevoSocio;
        });

        res.status(201).json({
            message: "Socio registrado exitosamente",
            data: {
                socio_id: resultadoTransaccion.id,
                codigo_socio: resultadoTransaccion.codigoSocio
            }
        });

    } catch (error) {
        console.error("Error al crear socio:", error);
        // Manejo de errores controlados dentro de la transacción
        if (error.message === "El plan de membresía seleccionado no existe.") {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Error interno del servidor al registrar al socio." });
    }
};