import prisma from "../config/prisma.js";
import { createClient } from "@supabase/supabase-js";

// INICIALIZAR SUPABASE 
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; 

if (!supabaseUrl || !supabaseKey) {
    console.error("FALTAN VARIABLES DE ENTORNO DE SUPABASE EN EL .ENV");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// CREAR UN BACKUP MANUAL
export const crearBackup = async (req, res) => {
    try {
        const usuarioId = req.user?.id || null;
        
        // A) EXTRAER LOS DATOS CRÍTICOS 
        const [
            socios, usuarios, productos, 
            membresiasPlanes, membresiasSocios, accesos
        ] = await Promise.all([
            prisma.socio.findMany(),
            prisma.usuario.findMany(),
            prisma.producto.findMany(),
            prisma.membresiaPlan.findMany(),
            prisma.membresiaSocio.findMany(),
            prisma.acceso.findMany({ take: 5000, orderBy: { fechaHora: 'desc' } }) 
        ]);

        const snapshot = {
            fechaGeneracion: new Date().toISOString(),
            infoGym: "Backup General - Sistema Kiosko",
            datos: { socios, usuarios, productos, membresiasPlanes, membresiasSocios, accesos }
        };

        const jsonString = JSON.stringify(snapshot);
        
        // B) CALCULAR TAMAÑO
        const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
        const sizeMb = parseFloat((sizeBytes / (1024 * 1024)).toFixed(3));

        // C) GENERAR NOMBRE DE ARCHIVO ÚNICO
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup_manual_${timestamp}.json`;

        // D) SUBIR AL BUCKET PRIVADO DE SUPABASE
        const { data, error: uploadError } = await supabase.storage
            .from('backups')
            .upload(fileName, jsonString, {
                contentType: 'application/json',
                upsert: false
            });

        if (uploadError) throw new Error(`Error en Supabase: ${uploadError.message}`);

        // E) REGISTRAR EN LA BASE DE DATOS
        const nuevoLog = await prisma.backupLog.create({
            data: {
                tipo: 'manual',
                status: 'exitoso',
                archivo: fileName,
                rutaLocal: 'Supabase Storage', 
                rutaRemota: fileName, 
                tamanoMb: sizeMb,
                generadoPor: usuarioId 
            }
        });

        res.status(201).json({
            success: true,
            message: "Backup generado y encriptado en la nube exitosamente.",
            data: nuevoLog
        });

    } catch (error) {
        console.error("Error al crear backup:", error);
        
        // Registrar el fallo en la bitácora 
        if (req.user?.id) {
            await prisma.backupLog.create({
                data: { 
                    tipo: 'manual', 
                    status: 'fallido', 
                    archivo: 'error_generacion',
                    rutaLocal: 'N/A', 
                    rutaRemota: 'N/A', 
                    tamanoMb: 0, 
                    generadoPor: req.user.id 
                }
            }).catch(e => console.log("No se pudo guardar el error en DB", e));
        }

        res.status(500).json({ success: false, message: "Error interno al generar el backup." });
    }
};

// OBTENER EL HISTORIAL 
export const obtenerHistorialBackups = async (req, res) => {
    try {
        const backups = await prisma.backupLog.findMany({
            orderBy: { generadoEn: 'desc' }, 
            include: { usuario: { select: { nombreCompleto: true } } } 
        });

        res.status(200).json({ success: true, data: backups });
    } catch (error) {
        console.error("Error historial:", error);
        res.status(500).json({ success: false, message: "Error al obtener historial de backups." });
    }
};

// DESCARGAR UN BACKUP (Genera URL Firmada)
export const descargarBackup = async (req, res) => {
    try {
        const { fileName } = req.params;

        const { data, error } = await supabase.storage
            .from('backups')
            .createSignedUrl(fileName, 60);

        if (error) throw new Error(error.message);

        res.status(200).json({
            success: true,
            message: "URL de descarga segura generada.",
            downloadUrl: data.signedUrl
        });
    } catch (error) {
        console.error("Error al generar link:", error);
        res.status(500).json({ success: false, message: "No se pudo generar el link de descarga." });
    }
};