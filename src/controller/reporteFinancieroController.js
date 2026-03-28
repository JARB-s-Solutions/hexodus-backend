import prisma from "../config/prisma.js";
import { registrarLog } from "../services/auditoriaService.js";
import { fechaStrAInicio, fechaStrAFin, fechaUTCADiaStr, fechaUTCAISOEnMerida } from "../utils/timezone.js";
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

// Inicializar Supabase Storage
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET_NAME = 'reportes';

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
            fecha_generacion: fechaUTCAISOEnMerida(r.createdAt), 
            generado_por: r.usuario.nombreCompleto,
            estado: r.estado,
            periodo: `${fechaUTCADiaStr(r.fechaInicio)} a ${fechaUTCADiaStr(r.fechaFin)}`
        }));

        res.status(200).json({
            message: "Historial obtenido",
            data: { reportes: reportesFormateados, paginacion: { total, pagina: page, limite: limit, totalPaginas: Math.ceil(total / limit) } }
        });
    } catch (error) {
        res.status(500).json({ error: "Error interno al obtener el historial." });
    }
};

// GENERAR REPORTE 
export const generarReporteFinanciero = async (req, res) => {
    try {
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: "El cuerpo de la petición está vacío." });
        }

        const { nombre, descripcion, tipo_reporte, formato, fecha_inicio, fecha_fin } = req.body;
        const formatoLimpio = (formato || 'CSV').toUpperCase();
        const inicioLocal = fechaStrAInicio(fecha_inicio);
        const finLocal = fechaStrAFin(fecha_fin);

        const movimientos = await prisma.cajaMovimiento.findMany({
            where: { fecha: { gte: inicioLocal, lte: finLocal } },
            include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
            orderBy: { fecha: 'asc' }
        });

        let totalIngresos = 0, totalGastos = 0;
        const filasProcesadas = movimientos.map(mov => {
            const monto = parseFloat(mov.monto);
            if (mov.tipo === 'ingreso') totalIngresos += monto;
            if (mov.tipo === 'gasto') totalGastos += monto;

            return {
                folio: `MOV-${mov.id}`,
                fecha: fechaUTCAISOEnMerida(mov.fecha).replace('T', ' '),
                tipo: mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
                concepto: mov.concepto.nombre,
                monto: monto,
                responsable: mov.usuario.nombreCompleto
            };
        });

        const extension = formatoLimpio === 'EXCEL' ? 'xlsx' : formatoLimpio.toLowerCase();
        const nombreArchivo = `${Date.now()}_reporte.${extension}`; // Nombre único para Supabase

        let fileBuffer;
        let contentType;

        // Generar en Memoria (Buffers)
        if (formatoLimpio === 'XLSX' || formatoLimpio === 'EXCEL') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Reporte Financiero');

            worksheet.addRow([`Reporte: ${nombre}`]).font = { bold: true, size: 14 };
            worksheet.addRow([`Periodo: ${fecha_inicio} al ${fecha_fin}`]);
            worksheet.addRow([]);
            const headerRow = worksheet.addRow(['Folio', 'Fecha', 'Tipo', 'Concepto', 'Monto', 'Responsable']);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
                cell.alignment = { horizontal: 'center' };
            });

            filasProcesadas.forEach(fila => {
                const row = worksheet.addRow([fila.folio, fila.fecha, fila.tipo, fila.concepto, fila.monto, fila.responsable]);
                row.getCell(5).numFmt = '"$"#,##0.00';
            });
            worksheet.columns.forEach(column => column.width = 20);
            
            worksheet.addRow([]);
            worksheet.addRow(['', '', '', 'TOTAL INGRESOS:', totalIngresos]).font = { bold: true };
            worksheet.addRow(['', '', '', 'TOTAL EGRESOS:', totalGastos]).font = { bold: true };
            worksheet.addRow(['', '', '', 'BALANCE NETO:', totalIngresos - totalGastos]).font = { bold: true };
            
            [worksheet.rowCount - 2, worksheet.rowCount - 1, worksheet.rowCount].forEach(r => worksheet.getRow(r).getCell(5).numFmt = '"$"#,##0.00');

            fileBuffer = await workbook.xlsx.writeBuffer();
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        } else if (formatoLimpio === 'PDF') {
            fileBuffer = await new Promise((resolve, reject) => {
                const doc = new PDFDocument({ margin: 50 });
                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                doc.fontSize(20).text('HEXODUS GYM', { align: 'center' });
                doc.fontSize(14).text(`Reporte: ${nombre}`, { align: 'center' });
                doc.fontSize(10).text(`Periodo: ${fecha_inicio} al ${fecha_fin}`, { align: 'center' });
                doc.moveDown();

                doc.fontSize(12).text('Resumen Financiero', { underline: true });
                doc.text(`Total Ingresos: $${totalIngresos.toFixed(2)} MXN`);
                doc.text(`Total Egresos: $${totalGastos.toFixed(2)} MXN`);
                doc.text(`Balance Neto: $${(totalIngresos - totalGastos).toFixed(2)} MXN`, { bold: true });
                doc.moveDown();

                doc.fontSize(12).text('Detalle de Movimientos', { underline: true });
                doc.moveDown(0.5);
                doc.fontSize(10);
                
                filasProcesadas.forEach(fila => {
                    doc.text(`${fila.fecha} | ${fila.tipo.toUpperCase()} | ${fila.concepto}`);
                    doc.text(`Folio: ${fila.folio} | Monto: $${fila.monto.toFixed(2)} | Resp: ${fila.responsable}`);
                    doc.moveDown(0.5);
                });

                doc.end();
            });
            contentType = 'application/pdf';

        } else {
            let csvContent = '\uFEFF'; 
            csvContent += `Reporte: ${nombre}\nPeriodo: ${fecha_inicio} al ${fecha_fin}\n\n`;
            csvContent += "Folio,Fecha,Tipo,Concepto,Monto,Responsable\n";
            filasProcesadas.forEach(fila => csvContent += `${fila.folio},${fila.fecha},${fila.tipo},"${fila.concepto}",$${fila.monto.toFixed(2)},"${fila.responsable}"\n`);
            csvContent += `\n,,,,TOTAL INGRESOS:,$${totalIngresos.toFixed(2)}\n,,,,TOTAL EGRESOS:,$${totalGastos.toFixed(2)}\n,,,,BALANCE NETO:,$${(totalIngresos - totalGastos).toFixed(2)}\n`;
            
            fileBuffer = Buffer.from(csvContent, 'utf8');
            contentType = 'text/csv; charset=utf-8';
        }

        // Subir a Supabase Storage
        const { error: uploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(nombreArchivo, fileBuffer, {
                contentType: contentType,
                upsert: false
            });

        if (uploadError) throw new Error(`Error al subir a Supabase: ${uploadError.message}`);

        // Guardar en Base de Datos
        const nuevoReporte = await prisma.reporteFinanciero.create({
            data: {
                nombre, descripcion, tipoReporte: tipo_reporte, formato: extension.toUpperCase(),
                fechaInicio: inicioLocal, fechaFin: finLocal,
                estado: 'completado', archivoUrl: nombreArchivo, usuarioId: req.user.id
            }
        });

        await registrarLog({ req, accion: 'generar', modulo: 'reportes', registroId: nuevoReporte.id, detalles: `Generado: ${nombre}` });

        res.status(201).json({ success: true, message: "Reporte generado", data: { id: nuevoReporte.id } });

    } catch (error) {
        console.error("Error al generar reporte:", error);
        res.status(500).json({ error: "Error interno al generar el reporte." });
    }
};

// DESCARGAR REPORTE (SIGNED URL DE SUPABASE)
export const descargarReporte = async (req, res) => {
    try {
        const { id } = req.params;
        const reporte = await prisma.reporteFinanciero.findUnique({ where: { id: parseInt(id) } });

        if (!reporte || reporte.isDeleted) return res.status(404).json({ error: "Reporte no encontrado." });
        if (reporte.estado !== 'completado' || !reporte.archivoUrl) return res.status(400).json({ error: "El archivo no está listo." });

        // Generar un enlace temporal (60 segundos) seguro
        const fileName = `${reporte.nombre.replace(/\s+/g, '_')}.${reporte.formato.toLowerCase()}`;
        
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(reporte.archivoUrl, 60, {
                download: fileName // Le dice al navegador que lo descargue con este nombre
            });

        if (error) throw new Error("No se pudo firmar la URL de descarga.");

        await registrarLog({ req, accion: 'descargar', modulo: 'reportes', registroId: reporte.id, detalles: `Descarga de reporte: ${reporte.nombre}` });

        // Devolver la URL firmada en un JSON para que el Frontend la abra
        res.status(200).json({
            success: true,
            message: "Enlace de descarga generado correctamente.",
            data: {
                downloadUrl: data.signedUrl
            }
        });

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