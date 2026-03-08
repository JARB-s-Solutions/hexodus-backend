import prisma from "../config/prisma.js";

export const ejecutarMantenimientoDiario = async (req, res) => {
    try {
        // 1. SEGURIDAD: Solo el sistema automatizado puede disparar esto
        const authHeader = req.headers.authorization;
        const cronSecret = process.env.CRON_SECRET;

        // Si hay un CRON_SECRET configurado, verificamos que coincida.
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: "No autorizado. Solo ejecución automatizada." });
        }

        const hoy = new Date();

        // Ejecutamos ambas tareas de limpieza en paralelo para mayor velocidad
        const [ofertasLimpias, membresiasVencidas] = await Promise.all([
            
            // TAREA 1: Desactivar ofertas expiradas en el catálogo de planes
            prisma.membresiaPlan.updateMany({
                where: {
                    esOferta: true,
                    fechaFinOferta: { lt: hoy }
                },
                data: {
                    esOferta: false,
                    precioOferta: null,
                    fechaFinOferta: null
                }
            }),

            // TAREA 2: Mover membresías de "activa" a "vencida"
            prisma.membresiaSocio.updateMany({
                where: {
                    status: 'activa', // Solo tocamos las activas, ignoramos las canceladas
                    fechaFin: { lt: hoy } // Si la fecha fin ya quedó en el pasado
                },
                data: {
                    status: 'vencida'
                }
            })
        ]);

        // Responder con un reporte de lo que hizo el vigilante
        res.status(200).json({
            message: "Mantenimiento diario completado con éxito 🦇",
            reporte: {
                ofertas_desactivadas: ofertasLimpias.count,
                membresias_vencidas: membresiasVencidas.count,
                fecha_ejecucion: hoy.toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Error en el Vigilante Nocturno (Cron):", error);
        res.status(500).json({ error: "Error interno ejecutando el mantenimiento." });
    }
};