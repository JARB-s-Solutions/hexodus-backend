import prisma from "../config/prisma.js";

export const ejecutarMantenimientoDiario = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: "No autorizado. Solo ejecución automatizada." });
        }

        const hoy = new Date();

        // TAREA 1: LIMPIEZA DE BASE DE DATOS
        const [ofertasLimpias, membresiasVencidas] = await Promise.all([
            prisma.membresiaPlan.updateMany({
                where: { esOferta: true, fechaFinOferta: { lt: hoy } },
                data: { esOferta: false, precioOferta: null, fechaFinOferta: null }
            }),
            prisma.membresiaSocio.updateMany({
                where: { status: 'activa', fechaFin: { lt: hoy } },
                data: { status: 'vencida' }
            })
        ]);

        // TAREA 2: GENERACIÓN DE ALERTAS
        let config = await prisma.configuracionAlerta.findFirst();
        if (!config) config = await prisma.configuracionAlerta.create({ data: {} }); // Crea default si no existe

        let nuevasAlertas = 0;

        // A) ALERTAS DE STOCK BAJO
        if (config.alertaStockActiva) {
            const productos = await prisma.producto.findMany({ where: { isDeleted: false, status: 'activo' } });
            for (const prod of productos) {
                // Usa el stock mínimo específico del producto si existe, o el global si no
                const umbral = (prod.stockMinimo && prod.stockMinimo > 0) ? prod.stockMinimo : config.alertaStockMinimo;
                
                if (prod.stock <= umbral) {
                    const existe = await prisma.alertaSistema.findFirst({
                        where: { tipo: 'stock_bajo', estado: 'activa', productoId: prod.id }
                    });
                    
                    if (!existe) {
                        await prisma.alertaSistema.create({
                            data: {
                                tipo: 'stock_bajo',
                                prioridad: prod.stock === 0 ? 'urgente' : 'alta',
                                titulo: `Stock crítico: ${prod.nombre}`,
                                descripcion: `Quedan ${prod.stock} unidades en inventario. Umbral de alerta: ${umbral}.`,
                                productoId: prod.id
                            }
                        });
                        nuevasAlertas++;
                    }
                }
            }
        }

        // B) VENCIMIENTOS PRÓXIMOS
        if (config.alertaVencimientosActiva) {
            const limiteVencimiento = new Date();
            limiteVencimiento.setDate(limiteVencimiento.getDate() + config.alertaVencimientosDias);

            const membresiasPorVencer = await prisma.membresiaSocio.findMany({
                where: { status: 'activa', fechaFin: { lte: limiteVencimiento, gte: hoy } },
                include: { socio: true, plan: true }
            });

            for (const mem of membresiasPorVencer) {
                const existe = await prisma.alertaSistema.findFirst({
                    where: { tipo: 'vencimiento_membresia', estado: 'activa', membresiaSocioId: mem.id }
                });
                
                if (!existe) {
                    await prisma.alertaSistema.create({
                        data: {
                            tipo: 'vencimiento_membresia',
                            prioridad: 'media',
                            titulo: `Vencimiento próximo: ${mem.socio.nombreCompleto}`,
                            descripcion: `La membresía '${mem.plan.nombre}' vencerá el ${mem.fechaFin.toISOString().split('T')[0]}.`,
                            socioId: mem.socio.id,
                            membresiaSocioId: mem.id
                        }
                    });
                    nuevasAlertas++;
                }
            }
        }

        // C) INACTIVIDAD DE SOCIOS
        if (config.alertaInactividadActiva) {
            const limiteInactividad = new Date();
            limiteInactividad.setDate(limiteInactividad.getDate() - config.alertaInactividadDias);

            const sociosActivos = await prisma.socio.findMany({
                where: { status: 'activo', isDeleted: false },
                include: { accesos: { orderBy: { fechaHora: 'desc' }, take: 1 } }
            });

            for (const socio of sociosActivos) {
                let ultimoAcceso = socio.accesos.length > 0 ? socio.accesos[0].fechaHora : socio.createdAt;
                
                if (ultimoAcceso < limiteInactividad) {
                    const existe = await prisma.alertaSistema.findFirst({
                        where: { tipo: 'inactividad_socio', estado: 'activa', socioId: socio.id }
                    });
                    
                    if (!existe) {
                        await prisma.alertaSistema.create({
                            data: {
                                tipo: 'inactividad_socio',
                                prioridad: 'baja',
                                titulo: `Socio inactivo: ${socio.nombreCompleto}`,
                                descripcion: `No ha registrado asistencia desde hace más de ${config.alertaInactividadDias} días.`,
                                socioId: socio.id
                            }
                        });
                        nuevasAlertas++;
                    }
                }
            }
        }

        // D) PAGOS PENDIENTES
        if (config.alertaPagosActiva) {
            const membresiasSinPagar = await prisma.membresiaSocio.findMany({
                where: { status: 'activa', estadoPago: 'sin_pagar' },
                include: { socio: true, plan: true }
            });

            for (const mem of membresiasSinPagar) {
                const existe = await prisma.alertaSistema.findFirst({
                    where: { tipo: 'pago_pendiente', estado: 'activa', membresiaSocioId: mem.id }
                });
                
                if (!existe) {
                    await prisma.alertaSistema.create({
                        data: {
                            tipo: 'pago_pendiente',
                            prioridad: 'alta',
                            titulo: `Pago pendiente: ${mem.socio.nombreCompleto}`,
                            descripcion: `El socio tiene un adeudo pendiente por la membresía '${mem.plan.nombre}'.`,
                            socioId: mem.socio.id,
                            membresiaSocioId: mem.id
                        }
                    });
                    nuevasAlertas++;
                }
            }
        }

        res.status(200).json({
            message: "Mantenimiento diario y evaluación de alertas completados con éxito 🦇",
            reporte: {
                ofertas_desactivadas: ofertasLimpias.count,
                membresias_vencidas: membresiasVencidas.count,
                nuevas_alertas_generadas: nuevasAlertas,
                fecha_ejecucion: hoy.toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Error en el Vigilante Nocturno (Cron):", error);
        res.status(500).json({ error: "Error interno ejecutando el mantenimiento." });
    }
};