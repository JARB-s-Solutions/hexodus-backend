import prisma from "../config/prisma.js";

export const listarLogs = async (req, res) => {
    try {
        const { modulo, usuarioId, accion, desde, hasta, page = 1 } = req.query;
        const limit = 50;
        const skip = (page - 1) * limit;

        const where = {};
        if (modulo) where.modulo = modulo;
        if (usuarioId) where.usuarioId = parseInt(usuarioId);
        if (accion) where.accion = accion;
        
        // 🔥 CAMBIO AQUÍ: Usamos 'timestamp' en lugar de 'createdAt'
        if (desde && hasta) {
            where.timestamp = {
                gte: new Date(desde),
                lte: new Date(hasta)
            };
        }

        const [logs, total] = await Promise.all([
            prisma.auditoriaLog.findMany({
                where,
                take: limit,
                skip: skip,
                // 🔥 CAMBIO AQUÍ: Usamos 'timestamp'
                orderBy: { timestamp: 'desc' }, 
                include: {
                    usuario: { select: { username: true, nombreCompleto: true } }
                }
            }),
            prisma.auditoriaLog.count({ where })
        ]);

        res.status(200).json({
            success: true,
            data: logs,
            pagination: {
                total,
                paginas: Math.ceil(total / limit),
                paginaActual: parseInt(page)
            }
        });
    } catch (error) {
        console.error("Error en listarLogs:", error);
        res.status(500).json({ success: false, error: "Error al obtener la bitácora" });
    }
};