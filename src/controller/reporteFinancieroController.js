import prisma from "../config/prisma.js";

// ==========================================
// 1. LISTAR HISTORIAL DE REPORTES (Para la Tabla)
// ==========================================
export const listarHistorialReportes = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10; // Según el selector del UI
        const skip = (page - 1) * limit;

        const [totalRecords, reportes] = await Promise.all([
            prisma.reporteFinanciero.count(),
            prisma.reporteFinanciero.findMany({
                skip,
                take: limit,
                orderBy: { generadoEn: 'desc' },
                include: { usuario: { select: { nombreCompleto: true } } }
            })
        ]);

        const dataFormateada = reportes.map(r => ({
            id: r.id,
            nombre: r.nombre,
            tipo: r.tipo,
            periodo: `${r.fechaInicio.toISOString().split('T')[0]} a ${r.fechaFin.toISOString().split('T')[0]}`,
            generado: r.generadoEn,
            estado: r.estado,
            formato: r.formato,
            archivo_url: r.archivoUrl,
            responsable: r.usuario.nombreCompleto
        }));

        res.status(200).json({
            message: "Historial de reportes obtenido",
            data: dataFormateada,
            pagination: {
                current_page: page,
                limit: limit,
                total_records: totalRecords,
                total_pages: Math.ceil(totalRecords / limit)
            }
        });
    } catch (error) {
        console.error("Error al listar historial:", error);
        res.status(500).json({ error: "Error interno al obtener el historial." });
    }
};

// ==========================================
// 2. GENERAR NUEVO REPORTE (Desde Modal)
// ==========================================
export const generarReporteFinanciero = async (req, res) => {
    try {
        const { 
            nombre, 
            descripcion, 
            tipo_reporte, 
            formato, 
            fecha_inicio, 
            fecha_fin,
            incluir_graficos,
            incluir_detalles 
        } = req.body;

        // Validaciones básicas requeridas por el UI
        if (!nombre || !fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: "Faltan campos obligatorios: Nombre y Rango de Fechas." });
        }

        // Crear el registro del reporte
        const nuevoReporte = await prisma.reporteFinanciero.create({
            data: {
                nombre,
                descripcion,
                tipo: tipo_reporte || 'Reporte Completo',
                formato: formato || 'Excel (.csv)',
                fechaInicio: new Date(fecha_inicio),
                fechaFin: new Date(fecha_fin),
                incluirGraficos: !!incluir_graficos,
                incluirDetalles: !!incluir_detalles,
                estado: 'Exitoso', 
                archivoUrl: `/exports/reporte_${Date.now()}.csv`, // Ruta simulada
                usuarioId: req.user.id
            }
        });

        // NOTA: Aquí se dispararía la lógica real de ExcelJS para crear el archivo físico.
        
        res.status(201).json({
            message: "Reporte generado con éxito.",
            data: nuevoReporte
        });

    } catch (error) {
        console.error("Error al generar reporte:", error);
        res.status(500).json({ error: "Error al procesar la solicitud del reporte." });
    }
};