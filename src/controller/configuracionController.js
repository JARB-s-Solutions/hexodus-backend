import prisma from "../config/prisma.js";
import { registrarLog } from "../services/auditoriaService.js";

// ==========================================
// HELPERS Y VALIDACIONES
// ==========================================

// Valida que sea un Base64 válido de imagen y pese menos de 2MB
const validarBase64 = (base64String, nombreCampo) => {
    if (!base64String) return null;
    
    if (base64String.startsWith('http://') || base64String.startsWith('https://')) {
        throw new Error(`El campo ${nombreCampo} no permite enlaces (URLs). Debe ser una imagen en Base64 para poder imprimirse en el ticket.`);
    }

    const regex = /^data:image\/(png|jpeg|jpg|gif);base64,/;
    if (!regex.test(base64String)) {
        throw new Error(`El campo ${nombreCampo} no tiene un formato Base64 válido (solo se permiten PNG, JPG o GIF).`);
    }

    // Calcular tamaño real decodificado (aprox)
    const base64Data = base64String.replace(regex, '');
    const sizeInBytes = Math.ceil((base64Data.length * 3) / 4);
    const sizeInMB = sizeInBytes / (1024 * 1024);
    
    if (sizeInMB > 2) {
        throw new Error(`La imagen en ${nombreCampo} supera el límite máximo de 2MB permitido.`);
    }

    return true;
};

// Singleton: Obtiene la config 1 o crea la default si no existe
const obtenerOcrearConfig = async () => {
    let config = await prisma.configuracionSistema.findUnique({ where: { id: 1 } });
    
    if (!config) {
        config = await prisma.configuracionSistema.create({
            data: {
                id: 1,
                colorPrincipal: "#FF3B3B",
                colorSecundario: "#00BFFF",
                modoTema: "dark",
                nombreSistema: "HEXODUS",
                gimnasioNombre: "GYM FITNESS",
                gimnasioDomicilio: "Av. Principal #123, Col. Centro, CP 12345",
                gimnasioTelefono: "+52 123 456 7890",
                gimnasioRFC: "XAXX010101000",
                ticketFooter: "¡Gracias por tu visita!",
                ticketMensajeAgradecimiento: "Te esperamos pronto"
            }
        });
    }
    return config;
};


// ==========================================
// ENDPOINTS REST
// ==========================================

// GET Configuración Unificada
export const getConfiguracion = async (req, res) => {
    try {
        const config = await obtenerOcrearConfig();
        
        res.status(200).json({
            success: true,
            message: "Configuración obtenida",
            data: config
        });
    } catch (error) {
        console.error("Error al obtener config:", error);
        res.status(500).json({ success: false, message: "Error interno al obtener la configuración." });
    }
};

// PUT Configuración Total
export const actualizarConfiguracionTotal = async (req, res) => {
    try {
        const body = req.body;

        // Validaciones Base64 (ISSUE 5)
        try {
            if (body.logoSistema) validarBase64(body.logoSistema, 'logoSistema');
            if (body.gimnasioLogo) validarBase64(body.gimnasioLogo, 'gimnasioLogo');
        } catch (validationError) {
            return res.status(400).json({ success: false, message: "Logo inválido", errors: [{ field: "logo", detail: validationError.message }] });
        }

        const dataUpdate = {
            colorPrincipal: body.colorPrincipal,
            colorSecundario: body.colorSecundario,
            modoTema: body.modoTema,
            nombreSistema: body.nombreSistema,
            logoSistema: body.logoSistema || null,
            gimnasioNombre: body.gimnasioNombre,
            gimnasioDomicilio: body.gimnasioDomicilio,
            gimnasioTelefono: body.gimnasioTelefono,
            gimnasioRFC: body.gimnasioRFC ? body.gimnasioRFC.toUpperCase() : undefined,
            gimnasioLogo: body.gimnasioLogo || null,
            ticketFooter: body.ticketFooter,
            ticketMensajeAgradecimiento: body.ticketMensajeAgradecimiento,
            updatedBy: req.user.id
        };

        const configActualizada = await prisma.configuracionSistema.upsert({
            where: { id: 1 },
            update: dataUpdate,
            create: { id: 1, ...dataUpdate }
        });

        await registrarLog({ req, accion: 'editar', modulo: 'configuracion', registroId: 1, detalles: 'Actualización total de la configuración del sistema y ticket.' });

        res.status(200).json({ success: true, message: "Configuración actualizada", data: configActualizada });

    } catch (error) {
        console.error("Error al actualizar config:", error);
        res.status(500).json({ success: false, message: "Error interno al actualizar la configuración." });
    }
};

// PATCH Solo Apariencia
export const actualizarApariencia = async (req, res) => {
    try {
        const { colorPrincipal, colorSecundario, modoTema, nombreSistema, logoSistema } = req.body;

        try { if (logoSistema) validarBase64(logoSistema, 'logoSistema'); } 
        catch (err) { return res.status(400).json({ success: false, message: "Logo inválido", errors: [{ field: "logo", detail: err.message }] }); }

        await obtenerOcrearConfig();

        const configActualizada = await prisma.configuracionSistema.update({
            where: { id: 1 },
            data: { 
                colorPrincipal, colorSecundario, modoTema, nombreSistema, 
                ...(logoSistema !== undefined && { logoSistema }),
                updatedBy: req.user.id 
            }
        });

        res.status(200).json({ success: true, message: "Apariencia actualizada", data: configActualizada });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error interno al actualizar apariencia." });
    }
};

// PATCH Solo Ticket
export const actualizarTicket = async (req, res) => {
    try {
        const { gimnasioNombre, gimnasioDomicilio, gimnasioTelefono, gimnasioRFC, gimnasioLogo, ticketFooter, ticketMensajeAgradecimiento } = req.body;

        try { if (gimnasioLogo) validarBase64(gimnasioLogo, 'gimnasioLogo'); } 
        catch (err) { return res.status(400).json({ success: false, message: "Logo inválido", errors: [{ field: "logo", detail: err.message }] }); }

        await obtenerOcrearConfig();

        const configActualizada = await prisma.configuracionSistema.update({
            where: { id: 1 },
            data: {
                gimnasioNombre, gimnasioDomicilio, gimnasioTelefono, 
                gimnasioRFC: gimnasioRFC ? gimnasioRFC.toUpperCase() : undefined,
                ticketFooter, ticketMensajeAgradecimiento,
                ...(gimnasioLogo !== undefined && { gimnasioLogo }),
                updatedBy: req.user.id
            }
        });

        res.status(200).json({ success: true, message: "Datos del ticket actualizados", data: configActualizada });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error interno al actualizar el ticket." });
    }
};

// DELETE Logos Individuales
export const eliminarLogoApariencia = async (req, res) => {
    try {
        await obtenerOcrearConfig();
        await prisma.configuracionSistema.update({ where: { id: 1 }, data: { logoSistema: null, updatedBy: req.user.id } });
        res.status(200).json({ success: true, message: "Logo de apariencia eliminado" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error al eliminar el logo." });
    }
};

export const eliminarLogoTicket = async (req, res) => {
    try {
        await obtenerOcrearConfig();
        await prisma.configuracionSistema.update({ where: { id: 1 }, data: { gimnasioLogo: null, updatedBy: req.user.id } });
        res.status(200).json({ success: true, message: "Logo del ticket eliminado" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error al eliminar el logo del ticket." });
    }
};