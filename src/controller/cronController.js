import prisma from "../config/prisma.js";

export const limpiarOfertasExpiradas = async (req, res) => {
    try {
        // Seguridad para que solo Vercel pueda ejecutar esto
        const authHeader = req.headers.authorization;
        
        // Vercel enviará un token secreto que configuraremos en las variables de entorno
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return res.status(401).json({ error: "No autorizado. Solo ejecución automática." });
        }

        const hoy = new Date();

        // Ejecutar la actualización masiva en Prisma
        // Buscamos las que son oferta y cuya fecha fin es menor (lt) a este exacto momento
        const resultado = await prisma.membresiaPlan.updateMany({
            where: {
                esOferta: true,
                fechaFinOferta: {
                    lt: hoy // lt = less than (menor que hoy)
                }
            },
            data: {
                esOferta: false,
                precioOferta: null,
                fechaFinOferta: null
            }
        });

        // Responder con el reporte
        res.status(200).json({
            message: "Limpieza automática de ofertas completada exitosamente.",
            ofertas_desactivadas: resultado.count // Te dirá cuántas desactivó
        });

    } catch (error) {
        console.error("Error en el Cron Job de ofertas:", error);
        res.status(500).json({ error: "Error interno ejecutando la limpieza de ofertas." });
    }
};