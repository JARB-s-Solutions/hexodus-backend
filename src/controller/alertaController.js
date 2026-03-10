import prisma from "../config/prisma.js";

// OBTENER ALERTAS (Para pintar el Dashboard)
export const obtenerAlertas = async (req, res) => {
    try {
        const { estado = 'activa' } = req.query;

        // Prisma ordena los enums según su creación, desc pone urgente primero
        const alertas = await prisma.alertaSistema.findMany({
            where: { estado: estado },
            orderBy: [
                { prioridad: 'desc' }, 
                { createdAt: 'desc' }
            ],
            include: {
                socio: { select: { id: true, nombreCompleto: true, codigoSocio: true, fotoUrl: true } },
                producto: { select: { id: true, nombre: true, stock: true } }
            }
        });

        // Contadores para los "Badges" del frontend
        const contadoresRaw = await prisma.alertaSistema.groupBy({
            by: ['prioridad'],
            where: { estado: 'activa' },
            _count: { _all: true }
        });

        const resumen = { baja: 0, media: 0, alta: 0, urgente: 0, total: 0 };
        contadoresRaw.forEach(c => {
            resumen[c.prioridad] = c._count._all;
            resumen.total += c._count._all;
        });

        res.status(200).json({ success: true, data: alertas, resumen });
    } catch (error) {
        console.error("Error al obtener alertas:", error);
        res.status(500).json({ success: false, message: "Error interno al obtener alertas." });
    }
};

// RESOLVER O DESCARTAR UNA ALERTA
export const actualizarEstadoAlerta = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, notas } = req.body; // Puede ser 'resuelta' o 'descartada'
        const usuarioId = req.user.id; // Del token JWT

        if (!['resuelta', 'descartada'].includes(estado)) {
            return res.status(400).json({ success: false, message: "Estado de alerta inválido." });
        }

        const alerta = await prisma.alertaSistema.update({
            where: { id },
            data: {
                estado: estado,
                resueltaPorId: usuarioId,
                fechaResolucion: new Date(),
                notasResolucion: notas
            }
        });

        res.status(200).json({ success: true, message: `Alerta marcada como ${estado}.`, data: alerta });
    } catch (error) {
        console.error("Error al actualizar alerta:", error);
        res.status(500).json({ success: false, message: "Error interno al actualizar alerta." });
    }
};

// OBTENER CONFIGURACIÓN
export const obtenerConfiguracion = async (req, res) => {
    try {
        let config = await prisma.configuracionAlerta.findFirst();
        if (!config) config = await prisma.configuracionAlerta.create({ data: {} });
        
        res.status(200).json({ success: true, data: config });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error interno." });
    }
};

// ACTUALIZAR CONFIGURACIÓN (Desde el panel de Admin)
export const actualizarConfiguracion = async (req, res) => {
    try {
        const datosUpdate = req.body;
        
        let config = await prisma.configuracionAlerta.findFirst();
        
        if (config) {
            config = await prisma.configuracionAlerta.update({
                where: { id: config.id },
                data: datosUpdate
            });
        } else {
            config = await prisma.configuracionAlerta.create({ data: datosUpdate });
        }

        res.status(200).json({ success: true, message: "Configuración actualizada.", data: config });
    } catch (error) {
        console.error("Error al guardar config:", error);
        res.status(500).json({ success: false, message: "Error al actualizar configuración." });
    }
};