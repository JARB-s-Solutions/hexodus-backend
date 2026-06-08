import prisma from "../config/prisma.js";
import { registrarLog } from "../services/auditoriaService.js";
import { fechaStrAInicio, fechaStrAFin, fechaUTCADiaStr, fechaUTCAISOEnMerida } from "../utils/timezone.js";
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

// Inicializar Supabase Storage
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET_NAME = 'reportes';

const TIPO_REPORTE_NORMALIZADO = {
    'todos': 'Completo',
    'completo': 'Completo',
    'reporte_completo': 'Completo',
    'reporte completo': 'Completo',
    'ventas': 'Ventas',
    'gastos': 'Gastos',
    'utilidad': 'Utilidad',
    'membresias': 'Membresias',
    'membresías': 'Membresias',
};

const money = (value) => Number.parseFloat(value || 0) || 0;
const formatMoney = (value) => `$${money(value).toFixed(2)}`;
const shouldInclude = (tipoReporte, seccion) => tipoReporte === 'Completo' || tipoReporte === seccion;

function normalizarTipoReporte(tipoReporte) {
    const key = String(tipoReporte || 'Completo').trim().toLowerCase();
    return TIPO_REPORTE_NORMALIZADO[key] || 'Completo';
}

function normalizarBoolean(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return !['false', '0', 'no'].includes(value.trim().toLowerCase());
    return Boolean(value);
}

function csvCell(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
}

function addSectionTitle(worksheet, title) {
    const row = worksheet.addRow([title]);
    row.font = { bold: true, size: 13, color: { argb: 'FF111827' } };
    worksheet.addRow([]);
}

function styleHeaderRow(row) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
        cell.alignment = { horizontal: 'center' };
    });
}

function autosizeWorksheet(worksheet) {
    worksheet.columns.forEach(column => {
        let maxLength = 12;
        column.eachCell({ includeEmpty: true }, cell => {
            const length = String(cell.value ?? '').length;
            maxLength = Math.max(maxLength, Math.min(length + 2, 42));
        });
        column.width = maxLength;
    });
}

async function obtenerDatasetReporte({ inicioLocal, finLocal, tipoReporte }) {
    const includeVentas = shouldInclude(tipoReporte, 'Ventas') || tipoReporte === 'Utilidad';
    const includeMembresias = shouldInclude(tipoReporte, 'Membresias') || tipoReporte === 'Utilidad';

    const [movimientos, ventas, pagosMembresia] = await Promise.all([
        prisma.cajaMovimiento.findMany({
            where: { fecha: { gte: inicioLocal, lte: finLocal } },
            include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
            orderBy: { fecha: 'asc' }
        }),
        includeVentas
            ? prisma.venta.findMany({
                where: {
                    fechaVenta: { gte: inicioLocal, lte: finLocal },
                    isDeleted: false,
                },
                include: {
                    socio: { select: { nombreCompleto: true, codigoSocio: true } },
                    cajero: { select: { nombreCompleto: true } },
                    detalles: {
                        include: {
                            producto: {
                                select: {
                                    codigo: true,
                                    nombre: true,
                                    categoria: { select: { nombre: true } },
                                }
                            }
                        }
                    },
                    pagos: { include: { metodoPago: { select: { nombre: true } } } },
                },
                orderBy: { fechaVenta: 'asc' }
            })
            : Promise.resolve([]),
        includeMembresias
            ? prisma.pagoMembresia.findMany({
                where: { pagadoEn: { gte: inicioLocal, lte: finLocal } },
                include: {
                    metodoPago: { select: { nombre: true } },
                    cobrador: { select: { nombreCompleto: true } },
                    membresiaSocio: {
                        include: {
                            socio: { select: { nombreCompleto: true, codigoSocio: true } },
                            plan: { select: { nombre: true, duracionDias: true } },
                        }
                    },
                },
                orderBy: { pagadoEn: 'asc' }
            })
            : Promise.resolve([])
    ]);

    let totalIngresos = 0;
    let totalGastos = 0;
    let totalAperturas = 0;

    const filasMovimientos = movimientos.map(mov => {
        const monto = money(mov.monto);
        const nombreConcepto = mov.concepto ? mov.concepto.nombre.toLowerCase() : '';
        const esApertura = nombreConcepto.includes('apertura') || nombreConcepto.includes('fondo de caja');
        let tipoVisual = '';

        if (esApertura) {
            totalAperturas += monto;
            tipoVisual = 'Apertura de Caja';
        } else if (mov.tipo === 'ingreso') {
            totalIngresos += monto;
            tipoVisual = 'Ingreso';
        } else if (mov.tipo === 'gasto') {
            totalGastos += monto;
            tipoVisual = 'Egreso';
        }

        return {
            folio: `MOV-${mov.id}`,
            fecha: fechaUTCAISOEnMerida(mov.fecha).replace('T', ' '),
            tipo: tipoVisual,
            concepto: mov.concepto ? mov.concepto.nombre : 'Sin Concepto',
            monto,
            responsable: mov.usuario ? mov.usuario.nombreCompleto : 'Sistema'
        };
    });

    const ventasExitosas = ventas.filter(venta => venta.status === 'exitosa');
    const ventasCanceladas = ventas.filter(venta => venta.status === 'cancelada');

    const productosMap = new Map();
    const metodosPagoMap = new Map();
    const filasVentasDetalle = [];
    const membresiasMap = new Map();

    ventas.forEach(venta => {
        const pagosTexto = venta.pagos.length > 0
            ? venta.pagos.map(pago => `${pago.metodoPago?.nombre || 'Metodo no registrado'}: ${formatMoney(pago.monto)}`).join(' | ')
            : 'Sin pago registrado';

        venta.pagos.forEach(pago => {
            if (venta.status !== 'exitosa') return;
            const key = pago.metodoPago?.nombre || 'Metodo no registrado';
            const current = metodosPagoMap.get(key) || { metodo: key, transacciones: 0, total: 0 };
            current.transacciones += 1;
            current.total += money(pago.monto);
            metodosPagoMap.set(key, current);
        });

        venta.detalles.forEach(detalle => {
            const cantidad = Number(detalle.cantidad || 0);
            const subtotal = money(detalle.subtotalLinea);
            const ganancia = money(detalle.gananciaLinea);
            const categoria = detalle.producto?.categoria?.nombre || 'Sin categoria';

            if (venta.status === 'exitosa') {
                const key = `${detalle.productoId}-${detalle.nombreProducto}`;
                const current = productosMap.get(key) || {
                    codigo: detalle.codigoProducto || detalle.producto?.codigo || '',
                    producto: detalle.nombreProducto,
                    categoria,
                    unidades: 0,
                    ingresos: 0,
                    ganancia: 0,
                };
                current.unidades += cantidad;
                current.ingresos += subtotal;
                current.ganancia += ganancia;
                productosMap.set(key, current);
            }

            filasVentasDetalle.push({
                folio: `V-${venta.id}`,
                fecha: fechaUTCAISOEnMerida(venta.fechaVenta).replace('T', ' '),
                cliente: venta.socio ? `${venta.socio.nombreCompleto} (${venta.socio.codigoSocio})` : 'Publico general',
                cajero: venta.cajero?.nombreCompleto || 'Sistema',
                estado: venta.status,
                codigo: detalle.codigoProducto,
                producto: detalle.nombreProducto,
                categoria,
                cantidad,
                precioUnitario: money(detalle.precioUnitario),
                subtotal,
                ganancia,
                metodoPago: pagosTexto,
            });
        });
    });

    const filasMembresiasDetalle = pagosMembresia.map(pago => {
        const membresia = pago.membresiaSocio;
        const planNombre = membresia?.plan?.nombre || 'Plan no registrado';
        const monto = money(pago.monto);
        const current = membresiasMap.get(planNombre) || {
            plan: planNombre,
            cobros: 0,
            ingresos: 0,
            duracionDias: membresia?.plan?.duracionDias || 0,
        };

        current.cobros += 1;
        current.ingresos += monto;
        membresiasMap.set(planNombre, current);

        return {
            folio: `PM-${pago.id}`,
            fecha: fechaUTCAISOEnMerida(pago.pagadoEn).replace('T', ' '),
            socio: membresia?.socio
                ? `${membresia.socio.nombreCompleto} (${membresia.socio.codigoSocio})`
                : 'Socio no registrado',
            plan: planNombre,
            metodoPago: pago.metodoPago?.nombre || 'Metodo no registrado',
            monto,
            recibidoPor: pago.cobrador?.nombreCompleto || 'Sistema',
            referencia: pago.referencia || '',
        };
    });

    const productosVendidos = Array.from(productosMap.values())
        .sort((a, b) => b.unidades - a.unidades || b.ingresos - a.ingresos);

    const metodosPago = Array.from(metodosPagoMap.values())
        .sort((a, b) => b.total - a.total);

    const membresiasPorPlan = Array.from(membresiasMap.values())
        .sort((a, b) => b.ingresos - a.ingresos || b.cobros - a.cobros);

    const totalVentas = ventasExitosas.reduce((sum, venta) => sum + money(venta.total), 0);
    const unidadesVendidas = productosVendidos.reduce((sum, producto) => sum + producto.unidades, 0);
    const gananciaProductos = productosVendidos.reduce((sum, producto) => sum + producto.ganancia, 0);
    const totalMembresias = filasMembresiasDetalle.reduce((sum, pago) => sum + pago.monto, 0);

    return {
        movimientos,
        filasMovimientos,
        ventas,
        filasVentasDetalle,
        productosVendidos,
        metodosPago,
        filasMembresiasDetalle,
        membresiasPorPlan,
        resumen: {
            totalIngresos,
            totalGastos,
            totalAperturas,
            balanceNeto: totalIngresos - totalGastos,
            totalVentas,
            ventasExitosas: ventasExitosas.length,
            ventasCanceladas: ventasCanceladas.length,
            unidadesVendidas,
            gananciaProductos,
            totalMembresias,
            cobrosMembresia: filasMembresiasDetalle.length,
        },
    };
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

        const {
            nombre,
            descripcion,
            tipo_reporte,
            formato,
            fecha_inicio,
            fecha_fin,
            incluir_detalles = true,
        } = req.body;

        if (!nombre || !fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                error: "Nombre, fecha de inicio y fecha de fin son obligatorios para generar el reporte."
            });
        }

        const formatoLimpio = (formato || 'CSV').toUpperCase();
        const tipoReporte = normalizarTipoReporte(tipo_reporte);
        const inicioLocal = fechaStrAInicio(fecha_inicio);
        const finLocal = fechaStrAFin(fecha_fin);
        const incluirDetalles = normalizarBoolean(incluir_detalles, true);
        const incluirGraficos = false;

        if (Number.isNaN(inicioLocal.getTime()) || Number.isNaN(finLocal.getTime())) {
            return res.status(400).json({ error: "El rango de fechas no es válido." });
        }

        if (finLocal < inicioLocal) {
            return res.status(400).json({ error: "La fecha fin no puede ser anterior a la fecha inicio." });
        }

        const dataset = await obtenerDatasetReporte({ inicioLocal, finLocal, tipoReporte });
        const {
            filasMovimientos,
            filasVentasDetalle,
            productosVendidos,
            metodosPago,
            filasMembresiasDetalle,
            membresiasPorPlan,
            resumen,
        } = dataset;

        const incluyeVentas = shouldInclude(tipoReporte, 'Ventas') || tipoReporte === 'Utilidad';
        const incluyeMembresias = shouldInclude(tipoReporte, 'Membresias') || tipoReporte === 'Utilidad';
        const incluyeMovimientos = shouldInclude(tipoReporte, 'Gastos') || tipoReporte === 'Utilidad' || tipoReporte === 'Membresias';

        const extension = formatoLimpio === 'EXCEL' ? 'xlsx' : formatoLimpio.toLowerCase();
        const nombreArchivo = `${Date.now()}_reporte.${extension}`; // Nombre único para Supabase

        let fileBuffer;
        let contentType;

        // Generar en Memoria (Buffers)
        if (formatoLimpio === 'XLSX' || formatoLimpio === 'EXCEL') {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Hexodus';
            workbook.created = new Date();

            const resumenSheet = workbook.addWorksheet('Resumen');
            resumenSheet.addRow([nombre]).font = { bold: true, size: 16, color: { argb: 'FF111827' } };
            resumenSheet.addRow([descripcion || 'Reporte financiero generado desde Hexodus']);
            resumenSheet.addRow([`Tipo: ${tipoReporte}`]);
            resumenSheet.addRow([`Periodo: ${fecha_inicio} al ${fecha_fin}`]);
            resumenSheet.addRow([`Generado: ${fechaUTCAISOEnMerida(new Date()).replace('T', ' ')}`]);
            resumenSheet.addRow([]);
            styleHeaderRow(resumenSheet.addRow(['Indicador', 'Valor']));
            [
                ['Ingresos registrados', resumen.totalIngresos],
                ['Gastos registrados', resumen.totalGastos],
                ['Balance neto', resumen.balanceNeto],
                ['Fondo/aperturas de caja', resumen.totalAperturas],
                ['Ventas exitosas', resumen.ventasExitosas],
                ['Ventas canceladas', resumen.ventasCanceladas],
                ['Total vendido en productos', resumen.totalVentas],
                ['Unidades vendidas', resumen.unidadesVendidas],
                ['Ganancia estimada de productos', resumen.gananciaProductos],
                ['Ingresos por membresias', resumen.totalMembresias],
                ['Cobros de membresia', resumen.cobrosMembresia],
            ].forEach(([label, value]) => {
                const row = resumenSheet.addRow([label, value]);
                if (typeof value === 'number' && !label.toLowerCase().includes('ventas') && !label.toLowerCase().includes('unidades') && !label.toLowerCase().includes('cobros')) {
                    row.getCell(2).numFmt = '"$"#,##0.00';
                }
            });
            autosizeWorksheet(resumenSheet);

            if (incluyeMovimientos) {
                const movimientosSheet = workbook.addWorksheet('Movimientos');
                addSectionTitle(movimientosSheet, 'Movimientos financieros');
                styleHeaderRow(movimientosSheet.addRow(['Folio', 'Fecha', 'Tipo', 'Concepto', 'Monto', 'Responsable']));
                filasMovimientos.forEach(fila => {
                    const row = movimientosSheet.addRow([fila.folio, fila.fecha, fila.tipo, fila.concepto, fila.monto, fila.responsable]);
                    row.getCell(5).numFmt = '"$"#,##0.00';
                });
                movimientosSheet.views = [{ state: 'frozen', ySplit: 3 }];
                autosizeWorksheet(movimientosSheet);
            }

            if (incluyeVentas) {
                const productosSheet = workbook.addWorksheet('Productos Vendidos');
                addSectionTitle(productosSheet, 'Productos vendidos');
                styleHeaderRow(productosSheet.addRow(['Codigo', 'Producto', 'Categoria', 'Unidades', 'Ingresos', 'Ganancia estimada']));
                productosVendidos.forEach(producto => {
                    const row = productosSheet.addRow([
                        producto.codigo,
                        producto.producto,
                        producto.categoria,
                        producto.unidades,
                        producto.ingresos,
                        producto.ganancia,
                    ]);
                    row.getCell(5).numFmt = '"$"#,##0.00';
                    row.getCell(6).numFmt = '"$"#,##0.00';
                });
                productosSheet.views = [{ state: 'frozen', ySplit: 3 }];
                autosizeWorksheet(productosSheet);

                const pagosSheet = workbook.addWorksheet('Metodos de Pago');
                addSectionTitle(pagosSheet, 'Metodos de pago');
                styleHeaderRow(pagosSheet.addRow(['Metodo', 'Transacciones', 'Total']));
                metodosPago.forEach(metodo => {
                    const row = pagosSheet.addRow([metodo.metodo, metodo.transacciones, metodo.total]);
                    row.getCell(3).numFmt = '"$"#,##0.00';
                });
                autosizeWorksheet(pagosSheet);

                if (incluirDetalles) {
                    const detalleSheet = workbook.addWorksheet('Detalle Ventas');
                    addSectionTitle(detalleSheet, 'Detalle de ventas por producto');
                    styleHeaderRow(detalleSheet.addRow([
                        'Folio', 'Fecha', 'Cliente', 'Cajero', 'Estado', 'Codigo', 'Producto', 'Categoria',
                        'Cantidad', 'Precio Unitario', 'Subtotal', 'Ganancia', 'Metodo Pago'
                    ]));
                    filasVentasDetalle.forEach(fila => {
                        const row = detalleSheet.addRow([
                            fila.folio,
                            fila.fecha,
                            fila.cliente,
                            fila.cajero,
                            fila.estado,
                            fila.codigo,
                            fila.producto,
                            fila.categoria,
                            fila.cantidad,
                            fila.precioUnitario,
                            fila.subtotal,
                            fila.ganancia,
                            fila.metodoPago,
                        ]);
                        row.getCell(10).numFmt = '"$"#,##0.00';
                        row.getCell(11).numFmt = '"$"#,##0.00';
                        row.getCell(12).numFmt = '"$"#,##0.00';
                    });
                    detalleSheet.views = [{ state: 'frozen', ySplit: 3 }];
                    autosizeWorksheet(detalleSheet);
                }
            }

            if (incluyeMembresias) {
                const membresiasSheet = workbook.addWorksheet('Membresias');
                addSectionTitle(membresiasSheet, 'Membresias por plan');
                styleHeaderRow(membresiasSheet.addRow(['Plan', 'Cobros', 'Ingresos', 'Duracion dias']));
                membresiasPorPlan.forEach(plan => {
                    const row = membresiasSheet.addRow([plan.plan, plan.cobros, plan.ingresos, plan.duracionDias]);
                    row.getCell(3).numFmt = '"$"#,##0.00';
                });
                membresiasSheet.addRow([]);
                addSectionTitle(membresiasSheet, 'Detalle de cobros de membresia');
                styleHeaderRow(membresiasSheet.addRow(['Folio', 'Fecha', 'Socio', 'Plan', 'Metodo Pago', 'Monto', 'Recibido Por', 'Referencia']));
                filasMembresiasDetalle.forEach(fila => {
                    const row = membresiasSheet.addRow([
                        fila.folio,
                        fila.fecha,
                        fila.socio,
                        fila.plan,
                        fila.metodoPago,
                        fila.monto,
                        fila.recibidoPor,
                        fila.referencia,
                    ]);
                    row.getCell(6).numFmt = '"$"#,##0.00';
                });
                membresiasSheet.views = [{ state: 'frozen', ySplit: 3 }];
                autosizeWorksheet(membresiasSheet);
            }

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
                doc.fontSize(10).text(`Tipo: ${tipoReporte}`, { align: 'center' });
                doc.fontSize(10).text(`Periodo: ${fecha_inicio} al ${fecha_fin}`, { align: 'center' });
                doc.moveDown();

                doc.fontSize(12).text('Resumen Financiero', { underline: true });
                doc.text(`Ingresos registrados: ${formatMoney(resumen.totalIngresos)} MXN`);
                doc.text(`Gastos registrados: ${formatMoney(resumen.totalGastos)} MXN`);
                doc.text(`Balance neto: ${formatMoney(resumen.balanceNeto)} MXN`);
                doc.text(`Ventas exitosas: ${resumen.ventasExitosas}`);
                doc.text(`Ventas canceladas: ${resumen.ventasCanceladas}`);
                doc.text(`Unidades vendidas: ${resumen.unidadesVendidas}`);
                doc.text(`Ganancia estimada de productos: ${formatMoney(resumen.gananciaProductos)} MXN`);
                doc.text(`Ingresos por membresias: ${formatMoney(resumen.totalMembresias)} MXN`);
                doc.text(`Cobros de membresia: ${resumen.cobrosMembresia}`);
                doc.moveDown();

                const ensureSpace = (height = 80) => {
                    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
                };

                if (incluyeVentas) {
                    ensureSpace();
                    doc.fontSize(12).text('Productos vendidos', { underline: true });
                    doc.moveDown(0.5);
                    doc.fontSize(9);
                    if (productosVendidos.length === 0) {
                        doc.text('No se registraron productos vendidos en el periodo.');
                    } else {
                        productosVendidos.forEach(producto => {
                            ensureSpace(34);
                            doc.text(`${producto.producto} (${producto.codigo || 'Sin codigo'})`);
                            doc.text(`Categoria: ${producto.categoria} | Unidades: ${producto.unidades} | Ingresos: ${formatMoney(producto.ingresos)} | Ganancia: ${formatMoney(producto.ganancia)}`);
                            doc.moveDown(0.35);
                        });
                    }
                    doc.moveDown();

                    ensureSpace();
                    doc.fontSize(12).text('Metodos de pago', { underline: true });
                    doc.moveDown(0.5);
                    doc.fontSize(9);
                    if (metodosPago.length === 0) {
                        doc.text('No se registraron pagos exitosos en el periodo.');
                    } else {
                        metodosPago.forEach(metodo => {
                            ensureSpace(24);
                            doc.text(`${metodo.metodo}: ${formatMoney(metodo.total)} (${metodo.transacciones} transacciones)`);
                        });
                    }
                    doc.moveDown();

                    if (incluirDetalles) {
                        ensureSpace();
                        doc.fontSize(12).text('Detalle de ventas por producto', { underline: true });
                        doc.moveDown(0.5);
                        doc.fontSize(8);
                        if (filasVentasDetalle.length === 0) {
                            doc.text('No hay detalle de ventas para mostrar.');
                        } else {
                            filasVentasDetalle.forEach(fila => {
                                ensureSpace(42);
                                doc.text(`${fila.fecha} | ${fila.folio} | ${fila.estado.toUpperCase()} | ${fila.cliente}`);
                                doc.text(`${fila.cantidad} x ${fila.producto} (${fila.codigo || 'Sin codigo'}) | Subtotal: ${formatMoney(fila.subtotal)} | Pago: ${fila.metodoPago}`);
                                doc.moveDown(0.35);
                            });
                        }
                        doc.moveDown();
                    }
                }

                if (incluyeMembresias) {
                    ensureSpace();
                    doc.fontSize(12).text('Membresias por plan', { underline: true });
                    doc.moveDown(0.5);
                    doc.fontSize(9);
                    if (membresiasPorPlan.length === 0) {
                        doc.text('No se registraron cobros de membresia en el periodo.');
                    } else {
                        membresiasPorPlan.forEach(plan => {
                            ensureSpace(28);
                            doc.text(`${plan.plan}: ${formatMoney(plan.ingresos)} (${plan.cobros} cobros)`);
                        });
                    }
                    doc.moveDown();

                    if (incluirDetalles) {
                        ensureSpace();
                        doc.fontSize(12).text('Detalle de cobros de membresia', { underline: true });
                        doc.moveDown(0.5);
                        doc.fontSize(8);
                        filasMembresiasDetalle.forEach(fila => {
                            ensureSpace(38);
                            doc.text(`${fila.fecha} | ${fila.folio} | ${fila.socio}`);
                            doc.text(`${fila.plan} | ${fila.metodoPago} | ${formatMoney(fila.monto)} | Recibio: ${fila.recibidoPor}`);
                            doc.moveDown(0.35);
                        });
                    }
                    doc.moveDown();
                }

                if (incluyeMovimientos) {
                    ensureSpace();
                    doc.fontSize(12).text('Detalle de movimientos financieros', { underline: true });
                    doc.moveDown(0.5);
                    doc.fontSize(9);
                    filasMovimientos.forEach(fila => {
                        ensureSpace(34);
                        doc.text(`${fila.fecha} | ${fila.tipo.toUpperCase()} | ${fila.concepto}`);
                        doc.text(`Folio: ${fila.folio} | Monto: ${formatMoney(fila.monto)} | Responsable: ${fila.responsable}`);
                        doc.moveDown(0.35);
                    });
                }

                doc.end();
            });
            contentType = 'application/pdf';

        } else {
            let csvContent = '\uFEFF'; 
            csvContent += `${csvCell('Reporte')},${csvCell(nombre)}\n`;
            csvContent += `${csvCell('Tipo')},${csvCell(tipoReporte)}\n`;
            csvContent += `${csvCell('Periodo')},${csvCell(`${fecha_inicio} al ${fecha_fin}`)}\n\n`;
            csvContent += `${csvCell('RESUMEN')}\n`;
            csvContent += `${csvCell('Indicador')},${csvCell('Valor')}\n`;
            [
                ['Ingresos registrados', formatMoney(resumen.totalIngresos)],
                ['Gastos registrados', formatMoney(resumen.totalGastos)],
                ['Balance neto', formatMoney(resumen.balanceNeto)],
                ['Fondo/aperturas de caja', formatMoney(resumen.totalAperturas)],
                ['Ventas exitosas', resumen.ventasExitosas],
                ['Ventas canceladas', resumen.ventasCanceladas],
                ['Total vendido en productos', formatMoney(resumen.totalVentas)],
                ['Unidades vendidas', resumen.unidadesVendidas],
                ['Ganancia estimada de productos', formatMoney(resumen.gananciaProductos)],
                ['Ingresos por membresias', formatMoney(resumen.totalMembresias)],
                ['Cobros de membresia', resumen.cobrosMembresia],
            ].forEach(([label, value]) => {
                csvContent += `${csvCell(label)},${csvCell(value)}\n`;
            });

            if (incluyeVentas) {
                csvContent += `\n${csvCell('PRODUCTOS VENDIDOS')}\n`;
                csvContent += "Codigo,Producto,Categoria,Unidades,Ingresos,Ganancia Estimada\n";
                productosVendidos.forEach(producto => {
                    csvContent += [
                        producto.codigo,
                        producto.producto,
                        producto.categoria,
                        producto.unidades,
                        formatMoney(producto.ingresos),
                        formatMoney(producto.ganancia),
                    ].map(csvCell).join(',') + '\n';
                });

                csvContent += `\n${csvCell('METODOS DE PAGO')}\n`;
                csvContent += "Metodo,Transacciones,Total\n";
                metodosPago.forEach(metodo => {
                    csvContent += [metodo.metodo, metodo.transacciones, formatMoney(metodo.total)].map(csvCell).join(',') + '\n';
                });

                if (incluirDetalles) {
                    csvContent += `\n${csvCell('DETALLE DE VENTAS POR PRODUCTO')}\n`;
                    csvContent += "Folio,Fecha,Cliente,Cajero,Estado,Codigo,Producto,Categoria,Cantidad,Precio Unitario,Subtotal,Ganancia,Metodo Pago\n";
                    filasVentasDetalle.forEach(fila => {
                        csvContent += [
                            fila.folio,
                            fila.fecha,
                            fila.cliente,
                            fila.cajero,
                            fila.estado,
                            fila.codigo,
                            fila.producto,
                            fila.categoria,
                            fila.cantidad,
                            formatMoney(fila.precioUnitario),
                            formatMoney(fila.subtotal),
                            formatMoney(fila.ganancia),
                            fila.metodoPago,
                        ].map(csvCell).join(',') + '\n';
                    });
                }
            }

            if (incluyeMembresias) {
                csvContent += `\n${csvCell('MEMBRESIAS POR PLAN')}\n`;
                csvContent += "Plan,Cobros,Ingresos,Duracion Dias\n";
                membresiasPorPlan.forEach(plan => {
                    csvContent += [plan.plan, plan.cobros, formatMoney(plan.ingresos), plan.duracionDias].map(csvCell).join(',') + '\n';
                });

                if (incluirDetalles) {
                    csvContent += `\n${csvCell('DETALLE DE COBROS DE MEMBRESIA')}\n`;
                    csvContent += "Folio,Fecha,Socio,Plan,Metodo Pago,Monto,Recibido Por,Referencia\n";
                    filasMembresiasDetalle.forEach(fila => {
                        csvContent += [
                            fila.folio,
                            fila.fecha,
                            fila.socio,
                            fila.plan,
                            fila.metodoPago,
                            formatMoney(fila.monto),
                            fila.recibidoPor,
                            fila.referencia,
                        ].map(csvCell).join(',') + '\n';
                    });
                }
            }

            if (incluyeMovimientos) {
                csvContent += `\n${csvCell('MOVIMIENTOS FINANCIEROS')}\n`;
                csvContent += "Folio,Fecha,Tipo,Concepto,Monto,Responsable\n";
                filasMovimientos.forEach(fila => {
                    csvContent += [
                        fila.folio,
                        fila.fecha,
                        fila.tipo,
                        fila.concepto,
                        formatMoney(fila.monto),
                        fila.responsable,
                    ].map(csvCell).join(',') + '\n';
                });
            }
            
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
                nombre,
                descripcion,
                tipoReporte,
                formato: extension.toUpperCase(),
                fechaInicio: inicioLocal, fechaFin: finLocal,
                incluirGraficos,
                incluirDetalles,
                estado: 'completado',
                archivoUrl: nombreArchivo,
                usuarioId: req.user.id
            }
        });

        await registrarLog({
            req,
            accion: 'generar',
            modulo: 'reportes',
            registroId: nuevoReporte.id,
            detalles: `Generado: ${nombre} (${tipoReporte}/${extension.toUpperCase()})`
        });

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
