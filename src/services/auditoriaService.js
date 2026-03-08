import prisma from "../config/prisma.js";

export const registrarLog = async ({ req, usuarioId = null, accion, modulo, detalles, registroId = null }) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.get('User-Agent');

        const idUsuarioFinal = usuarioId || req.user?.id;

        if (!idUsuarioFinal) {
            console.warn("⚠️ Intento de auditoría sin usuarioId válido. Acción:", accion);
            return;
        }

        // 🔥 LA SOLUCIÓN: Acomodar los datos según tu schema.prisma
        let textoDescripcion = "";
        let jsonDetalles = {};

        // Si "detalles" es un string (ej. "Se editó la membresía"), lo mandamos a "descripcion"
        if (typeof detalles === 'string') {
            textoDescripcion = detalles;
        } else {
            // Si es un objeto, lo mandamos al JSON
            textoDescripcion = `Acción registrada en ${modulo}`;
            jsonDetalles = detalles || {};
        }

        // Metemos el registroId adentro del JSON de detalles (ya que no existe la columna como tal)
        if (registroId) {
            jsonDetalles.registroId = registroId;
        }

        await prisma.auditoriaLog.create({
            data: {
                usuario: { connect: { id: parseInt(idUsuarioFinal) } },
                accion: accion.toLowerCase(),
                modulo: modulo.toLowerCase(),
                descripcion: textoDescripcion, // Aquí va el texto explicativo
                detalles: Object.keys(jsonDetalles).length > 0 ? jsonDetalles : undefined, // Aquí va el objeto JSON
                ip: ip,
                userAgent: userAgent
            }
        });
    } catch (error) {
        console.error("❌ Error crítico en AuditoríaService:", error);
    }
};