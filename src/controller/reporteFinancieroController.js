import prisma from "../config/prisma.js";
import { registrarLog } from "../services/auditoriaService.js";
// Importamos tus utilidades de tiempo exactas
import { fechaStrAInicio, fechaStrAFin, fechaUTCADiaStr, fechaUTCAISOEnMerida } from "../utils/timezone.js";
import fs from "fs";
import path from "path";

// Aseguramos que exista la carpeta para guardar los reportes físicos
const tempDir = path.resolve('./temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// LISTAR HISTORIAL 
export const listarHistorialReportes = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [total, reportesRaw] = await Promise.all([
            prisma.reporteFinanciero.count({ where: { isDeleted: false } }),
            prisma.reporteFinanciero.findMany({
                where: { isDeleted: false },
                skip, take: limit,
                orderBy: { createdAt: 'desc' },
                include: { usuario: { select: { nombreCompleto: true } } }
            })
        ]);

        const reportesFormateados = reportesRaw.map(r => ({
            id: r.id,
            nombre: r.nombre,
            tipo: r.tipoReporte,
            formato: r.formato,
            // Usamos tu función para la hora exacta en Campeche
            fecha_generacion: fechaUTCAISOEnMerida(r.createdAt), 
            generado_por: r.usuario.nombreCompleto,
            estado: r.estado,
            periodo: `${fechaUTCADiaStr(r.fechaInicio)} a ${fechaUTCADiaStr(r.fechaFin)}`
        }));

        res.status(200).json({
            message: "Historial obtenido correctamente",
            data: {
                reportes: reportesFormateados,
                paginacion: { total, pagina: page, limite: limit, totalPaginas: Math.ceil(total / limit) }
            }
        });
    } catch (error) {
        console.error("Error al obtener historial:", error);
        res.status(500).json({ error: "Error interno al obtener el historial." });
    }
};

// GENERAR REPORTE CSV 
export const generarReporteFinanciero = async (req, res) => {
    try {
        // Evita que el servidor crashee si no mandan el Body
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: "El cuerpo de la petición (JSON) está vacío o mal formateado." });
        }

        const { nombre, descripcion, tipo_reporte, formato, fecha_inicio, fecha_fin } = req.body;

        // Blindaje horario para Campeche
        const inicioLocal = fechaStrAInicio(fecha_inicio);
        const finLocal = fechaStrAFin(fecha_fin);

        // Extraer datos
        const movimientos = await prisma.cajaMovimiento.findMany({
            where: { fecha: { gte: inicioLocal, lte: finLocal } },
            include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
            orderBy: { fecha: 'asc' }
        });

        // Crear CSV con UTF-8 BOM para los acentos en Excel
        let csvContent = '\uFEFF'; 
        csvContent += `Reporte: ${nombre}\nPeriodo: ${fecha_inicio} al ${fecha_fin}\n\n`;
        csvContent += "Folio,Fecha,Tipo,Concepto,Monto,Responsable\n";

        let totalIngresos = 0, totalGastos = 0;

        movimientos.forEach(mov => {
            const fechaLocal = fechaUTCAISOEnMerida(mov.fecha).replace('T', ' ');
            const tipo = mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso';
            const concepto = `"${mov.concepto.nombre}"`;
            const monto = parseFloat(mov.monto);
            const responsable = `"${mov.usuario.nombreCompleto}"`;

            if (mov.tipo === 'ingreso') totalIngresos += monto;
            if (mov.tipo === 'gasto') totalGastos += monto;

            csvContent += `MOV-${mov.id},${fechaLocal},${tipo},${concepto},$${monto.toFixed(2)},${responsable}\n`;
        });

        csvContent += `\n,,,,TOTAL INGRESOS:,$${totalIngresos.toFixed(2)}\n`;
        csvContent += `,,,,TOTAL EGRESOS:,$${totalGastos.toFixed(2)}\n`;
        csvContent += `,,,,BALANCE NETO:,$${(totalIngresos - totalGastos).toFixed(2)}\n`;

        // Guardar archivo
        const nombreArchivo = `reporte_${Date.now()}.csv`;
        const rutaRelativa = `./temp/${nombreArchivo}`;
        const rutaAbsoluta = path.join(tempDir, nombreArchivo);
        fs.writeFileSync(rutaAbsoluta, csvContent, 'utf8');

        // Guardar en BD
        const nuevoReporte = await prisma.reporteFinanciero.create({
            data: {
                nombre, descripcion, tipoReporte: tipo_reporte, formato: 'CSV',
                fechaInicio: inicioLocal, fechaFin: finLocal,
                estado: 'completado', archivoUrl: rutaRelativa, usuarioId: req.user.id
            }
        });

        await registrarLog({ req, accion: 'generar', modulo: 'reportes', registroId: nuevoReporte.id, detalles: `Generación CSV: ${nombre}` });

        res.status(201).json({ success: true, message: "Reporte generado", data: { id: nuevoReporte.id } });

    } catch (error) {
        console.error("Error al generar reporte:", error);
        res.status(500).json({ error: "Error interno al generar el reporte." });
    }
};

// DESCARGAR REPORTE 
export const descargarReporte = async (req, res) => {
    try {
        const { id } = req.params;
        const reporte = await prisma.reporteFinanciero.findUnique({ where: { id: parseInt(id) } });

        if (!reporte || reporte.isDeleted) return res.status(404).json({ error: "Reporte no encontrado." });
        if (reporte.estado !== 'completado' || !reporte.archivoUrl) return res.status(400).json({ error: "El archivo no está listo." });

        const filePath = path.resolve(reporte.archivoUrl);
        const fileName = `${reporte.nombre.replace(/\s+/g, '_')}.${reporte.formato.toLowerCase()}`;

        if (!fs.existsSync(filePath)) return res.status(404).json({ error: "El archivo físico no fue encontrado." });

        await registrarLog({ req, accion: 'descargar', modulo: 'reportes', registroId: reporte.id, detalles: `Descarga de reporte: ${reporte.nombre}` });

        res.download(filePath, fileName);
    } catch (error) {
        console.error("Error al descargar:", error);
        res.status(500).json({ error: "Error interno al procesar la descarga." });
    }
};

// ELIMINAR REPORTE 
export const eliminarReporte = async (req, res) => {
    try {
        const { id } = req.params;
        const reporte = await prisma.reporteFinanciero.findUnique({ where: { id: parseInt(id) } });

        if (!reporte || reporte.isDeleted) return res.status(404).json({ error: "Reporte no encontrado." });

        await prisma.reporteFinanciero.update({ where: { id: parseInt(id) }, data: { isDeleted: true } });

        await registrarLog({ req, accion: 'eliminar', modulo: 'reportes', registroId: reporte.id, detalles: `Reporte eliminado: ${reporte.nombre}` });

        res.status(200).json({ success: true, message: "Reporte eliminado del historial." });
    } catch (error) {
        console.error("Error al eliminar:", error);
        res.status(500).json({ error: "Error interno al eliminar el reporte." });
    }
};