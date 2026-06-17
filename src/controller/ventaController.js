import prisma from "../config/prisma.js";
import crypto from "crypto";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { ahoraEnMerida, localAUTC, fechaStrAInicio, fechaStrAFin, fechaUTCADiaStr, horaStringMerida } from "../utils/timezone.js";
import { registrarLog } from "../services/auditoriaService.js";

const formatoMoneda = (value) => Number(value || 0);

const formatoFechaHoraLocal = (date) => `${fechaUTCADiaStr(date)} ${horaStringMerida(date).slice(0, 5)}`;

const csvCell = (value) => {
    const raw = value === null || value === undefined ? "" : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
};

const aplicarEstiloHeader = (row) => {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    row.alignment = { vertical: "middle", horizontal: "center" };
    row.eachCell((cell) => {
        cell.border = {
            top: { style: "thin", color: { argb: "FFE5E7EB" } },
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
    });
};

const ajustarColumnas = (worksheet) => {
    worksheet.columns.forEach((column) => {
        let maxLength = 12;
        column.eachCell({ includeEmpty: true }, (cell) => {
            const value = cell.value;
            const text = value === null || value === undefined ? "" : String(value);
            maxLength = Math.max(maxLength, text.length + 2);
        });
        column.width = Math.min(maxLength, 42);
    });
};

function construirFiltrosVentas(query) {
    const { search, periodo, fecha_inicio, fecha_fin, metodo_pago } = query;
    const whereClause = { isDeleted: false };

    if (metodo_pago && !["todos", "Todos", "Todos los Metodos", "Todos los Métodos"].includes(metodo_pago)) {
        whereClause.pagos = {
            some: {
                metodoPago: { nombre: { equals: metodo_pago, mode: "insensitive" } }
            }
        };
    }

    if (search) {
        const orConditions = [
            { socio: { nombreCompleto: { contains: search, mode: "insensitive" } } },
            { detalles: { some: { nombreProducto: { contains: search, mode: "insensitive" } } } }
        ];

        const numSearch = parseInt(String(search).replace(/\D/g, ""));
        if (!isNaN(numSearch)) {
            orConditions.push({ id: numSearch });
        }

        whereClause.OR = orConditions;
    }

    const { year: _y, month: _m, day: _d } = ahoraEnMerida();
    let gteDate = null;
    let lteDate = null;

    if (periodo && !["Todo", "Todos", "todo"].includes(periodo)) {
        gteDate = localAUTC(_y, _m, _d, 0, 0, 0, 0);
        lteDate = localAUTC(_y, _m, _d, 23, 59, 59, 999);

        switch (periodo) {
            case "Ayer":
                gteDate = localAUTC(_y, _m, _d - 1, 0, 0, 0, 0);
                lteDate = localAUTC(_y, _m, _d - 1, 23, 59, 59, 999);
                break;
            case "Esta Semana": {
                const dowISO = new Date(Date.UTC(_y, _m - 1, _d)).getUTCDay() || 7;
                gteDate = localAUTC(_y, _m, _d - dowISO + 1, 0, 0, 0, 0);
                break;
            }
            case "Este Mes":
                gteDate = localAUTC(_y, _m, 1, 0, 0, 0, 0);
                break;
            case "Este Trimestre":
                gteDate = localAUTC(_y, Math.floor((_m - 1) / 3) * 3 + 1, 1, 0, 0, 0, 0);
                break;
            case "Este Semestre":
                gteDate = localAUTC(_y, _m <= 6 ? 1 : 7, 1, 0, 0, 0, 0);
                break;
            case "Este Año":
                gteDate = localAUTC(_y, 1, 1, 0, 0, 0, 0);
                break;
            case "Personalizado":
                gteDate = fecha_inicio ? fechaStrAInicio(fecha_inicio) : null;
                lteDate = fecha_fin ? fechaStrAFin(fecha_fin) : null;
                break;
        }

        if (gteDate || lteDate) {
            whereClause.fechaVenta = {};
            if (gteDate) whereClause.fechaVenta.gte = gteDate;
            if (lteDate) whereClause.fechaVenta.lte = lteDate;
        }
    }

    return { whereClause, gteDate, lteDate };
}

function obtenerResumenProductos(venta) {
    if (!venta.detalles || venta.detalles.length === 0) return "Sin productos";
    const primer = venta.detalles[0].nombreProducto;
    const extras = venta.detalles.length - 1;
    return extras > 0 ? `${primer} +${extras} mas` : primer;
}

function obtenerDetalleProductosNota(detalles) {
    const resumen = detalles
        .map((detalle) => `${detalle.nombreProducto} x${detalle.cantidad}`)
        .join(', ');

    return resumen.length > 180 ? `${resumen.slice(0, 177)}...` : resumen;
}

function obtenerMetodoPago(venta) {
    return venta.pagos?.length > 0
        ? venta.pagos.map((p) => p.metodoPago?.nombre || "No registrado").join(" + ")
        : "No registrado";
}

// REGISTRAR NUEVA VENTA (Punto de Venta) 
export const crearVenta = async (req, res) => {
    try {
        const { socio_id, metodo_pago_id, pagos, productos } = req.body;

        if (!productos || !Array.isArray(productos) || productos.length === 0) {
            return res.status(400).json({ error: "El carrito de compras está vacío o es inválido." });
        }

        // Verificar que la caja esté abierta
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (!cajaAbierta) {
            return res.status(403).json({ error: "Operación denegada: La caja está cerrada. Debes realizar la apertura de caja primero." });
        }

        // Consolidación y Validación de Cantidades
        const carritoConsolidadoMap = new Map();
        for (const item of productos) {
            const prodId = parseInt(item.producto_id);
            const cantidadParseada = parseInt(item.cantidad);

            if (isNaN(cantidadParseada) || cantidadParseada <= 0) {
                return res.status(400).json({ error: `Operación rechazada. La cantidad para el producto ID ${item.producto_id} debe ser mayor a 0.` });
            }
            if (isNaN(prodId)) {
                return res.status(400).json({ error: "ID de producto inválido en el carrito." });
            }

            if (carritoConsolidadoMap.has(prodId)) {
                carritoConsolidadoMap.get(prodId).cantidad += cantidadParseada;
            } else {
                carritoConsolidadoMap.set(prodId, { producto_id: prodId, cantidad: cantidadParseada });
            }
        }

        const productosConsolidados = Array.from(carritoConsolidadoMap.values());
        const productosIds = productosConsolidados.map(p => p.producto_id);

        const productosDB = await prisma.producto.findMany({
            where: { id: { in: productosIds }, isDeleted: false },
            include: { stock: true }
        });

        if (productosDB.length !== productosIds.length) {
            return res.status(400).json({ error: "Uno o más productos no existen o están inactivos." });
        }

        let totalVenta = 0;
        const detallesVenta = [];

        for (const itemFront of productosConsolidados) {
            const prodDB = productosDB.find(p => p.id === itemFront.producto_id);
            const cantidadVender = itemFront.cantidad;
            const stockActual = prodDB.stock ? prodDB.stock.cantidad : 0;

            if (stockActual < cantidadVender) {
                return res.status(400).json({ error: `Stock insuficiente para '${prodDB.nombre}'. Solicitas ${cantidadVender} pero solo hay ${stockActual} disponibles.` });
            }

            const precioVenta = parseFloat(prodDB.precio);
            const costoCompra = parseFloat(prodDB.costo || 0);
            const subtotalLinea = precioVenta * cantidadVender;
            const gananciaLinea = (precioVenta - costoCompra) * cantidadVender;

            totalVenta += subtotalLinea;

            detallesVenta.push({
                productoId: prodDB.id, codigoProducto: prodDB.codigo, nombreProducto: prodDB.nombre,
                cantidad: cantidadVender, precioUnitario: precioVenta, costoUnitario: costoCompra, subtotalLinea, gananciaLinea
            });
        }

        // LÓGICA DE PAGOS DIVIDIDOS (Retrocompatible)
        const listaPagos = pagos && pagos.length > 0 ? pagos : (metodo_pago_id ? [{ metodo_pago_id, monto: totalVenta }] : []);
        
        if (listaPagos.length === 0) {
            return res.status(400).json({ error: "Debes seleccionar al menos un método de pago." });
        }

        const totalPagado = listaPagos.reduce((acc, p) => acc + parseFloat(p.monto), 0);
        if (Math.abs(totalPagado - totalVenta) > 0.01) {
            return res.status(400).json({ error: `El total de los pagos ($${totalPagado}) no coincide con el total de la venta ($${totalVenta}).` });
        }

        const productosNota = obtenerDetalleProductosNota(detallesVenta);

        // Transacción Maestra
        const resultado = await prisma.$transaction(async (tx) => {
            const nuevaVenta = await tx.venta.create({
                data: {
                    uuidVenta: crypto.randomUUID(), usuarioId: req.user.id, socioId: socio_id ? parseInt(socio_id) : null, 
                    status: 'exitosa', subtotal: totalVenta, descuento: 0, total: totalVenta
                }
            });

            for (const detalle of detallesVenta) {
                await tx.ventaDetalle.create({ data: { ventaId: nuevaVenta.id, ...detalle } });

                const stockActual = productosDB.find(p => p.id === detalle.productoId).stock;
                await tx.inventarioStock.update({
                    where: { productoId: detalle.productoId },
                    data: { cantidad: stockActual.cantidad - detalle.cantidad }
                });

                await tx.inventarioMovimiento.create({
                    data: {
                        productoId: detalle.productoId, tipo: 'OUT', cantidad: detalle.cantidad, costoUnitario: detalle.costoUnitario,
                        referenciaTipo: 'venta', referenciaId: nuevaVenta.id, usuarioId: req.user.id, nota: `Venta #${nuevaVenta.id}`
                    }
                });
            }

            let conceptoVenta = await tx.concepto.findFirst({ where: { nombre: 'Venta de Productos' } });
            if (!conceptoVenta) conceptoVenta = await tx.concepto.create({ data: { nombre: 'Venta de Productos', tipo: 'ingreso' } });

            // REGISTRAR CADA PAGO INDIVIDUALMENTE EN CAJA Y VENTAPAGO
            for (const pago of listaPagos) {
                const montoPago = parseFloat(pago.monto);

                // La tabla VentaPago SI tiene metodoPagoId, aquí se guarda la relación real
                await tx.ventaPago.create({
                    data: { ventaId: nuevaVenta.id, metodoPagoId: parseInt(pago.metodo_pago_id), monto: montoPago }
                });

                // La tabla CajaMovimiento NO lo tiene, usamos la nota para el historial
                await tx.cajaMovimiento.create({
                    data: {
                        corteId: cajaAbierta.id, 
                        usuarioId: req.user.id, 
                        conceptoId: conceptoVenta.id, 
                        tipo: 'ingreso',
                        monto: montoPago, 
                        referenciaTipo: 'venta', 
                        referenciaId: nuevaVenta.id,
                        nota: `[Pago: ID ${pago.metodo_pago_id}] Venta #${nuevaVenta.id} - Productos: ${productosNota}`
                    }
                });
            }

            return nuevaVenta;
        }, { maxWait: 5000, timeout: 20000 });

        res.status(201).json({ message: "Venta procesada exitosamente.", data: { venta_id: resultado.id, total_cobrado: resultado.total } });

    } catch (error) {
        console.error("Error al procesar la venta:", error);
        res.status(500).json({ error: "Error interno al procesar la venta." });
    }
};



// LISTAR HISTORIAL DE VENTAS (Con Filtros Avanzados y KPIs)
export const listarVentas = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const { year: _y, month: _m, day: _d } = ahoraEnMerida();
        const { periodo } = req.query;
        const { whereClause, gteDate, lteDate } = construirFiltrosVentas(req.query);

        // EJECUCIÓN PARALELA
        const mesInicio = localAUTC(_y, _m, 1, 0, 0, 0, 0);

        const [totalRecords, ventasPaginadas, aggregateFiltrado, ventasDelMes] = await Promise.all([
            prisma.venta.count({ where: whereClause }),
            
            prisma.venta.findMany({
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { fechaVenta: 'desc' },
                include: {
                    socio: { select: { nombreCompleto: true } },
                    detalles: true,
                    pagos: { include: { metodoPago: true } }
                }
            }),

            prisma.venta.aggregate({
                where: { ...whereClause, status: 'exitosa' }, 
                _sum: { total: true }
            }),

            prisma.venta.findMany({
                where: { isDeleted: false, status: 'exitosa', fechaVenta: { gte: mesInicio } },
                include: { detalles: { select: { cantidad: true } } }
            })
        ]);

        // CÁLCULO DE KPIs
        const hoyInicio = localAUTC(_y, _m, _d, 0, 0, 0, 0);
        const ayerInicio = localAUTC(_y, _m, _d - 1, 0, 0, 0, 0);
        const ayerFin = localAUTC(_y, _m, _d - 1, 23, 59, 59, 999);

        let ventasDiaTotal = 0, ventasAyerTotal = 0, transaccionesDia = 0;
        let productosDia = 0, productosAyer = 0, ventasMesTotal = 0;

        ventasDelMes.forEach(venta => {
            const fecha = new Date(venta.fechaVenta);
            const total = parseFloat(venta.total);
            const cantProd = venta.detalles.reduce((acc, det) => acc + det.cantidad, 0);

            ventasMesTotal += total;
            if (fecha >= hoyInicio) {
                ventasDiaTotal += total; transaccionesDia++; productosDia += cantProd;
            } else if (fecha >= ayerInicio && fecha <= ayerFin) {
                ventasAyerTotal += total; productosAyer += cantProd;
            }
        });

        let pctVentasVsAyer = ventasAyerTotal > 0 ? ((ventasDiaTotal - ventasAyerTotal) / ventasAyerTotal) * 100 : (ventasDiaTotal > 0 ? 100 : 0);
        let pctProdVsAyer = productosAyer > 0 ? ((productosDia - productosAyer) / productosAyer) * 100 : (productosDia > 0 ? 100 : 0);

        const dashboard_stats = {
            ventas_dia: { total: ventasDiaTotal, porcentaje_vs_ayer: Number(pctVentasVsAyer.toFixed(1)) },
            transacciones: { total: transaccionesDia, promedio_ticket: transaccionesDia > 0 ? Number((ventasDiaTotal / transaccionesDia).toFixed(2)) : 0 },
            productos_vendidos: { total: productosDia, porcentaje_vs_ayer: Number(pctProdVsAyer.toFixed(1)) },
            ventas_mes: { total: ventasMesTotal, meta_alcanzada: 20 }
        };

        let formatoFechaRango = "Todo el histórico";
        if (gteDate && lteDate) {
            formatoFechaRango = `${fechaUTCADiaStr(gteDate)} a ${fechaUTCADiaStr(lteDate)}`;
        } else if (periodo === 'Hoy') {
            formatoFechaRango = "Ventas de Hoy";
        }

        const summary_bar = {
            rango: formatoFechaRango,
            total_filtrado: aggregateFiltrado._sum.total ? parseFloat(aggregateFiltrado._sum.total) : 0,
            ventas_count: totalRecords
        };

        const dataFormateada = ventasPaginadas.map(venta => {
            return {
                id: venta.id,
                id_venta: `V-${venta.id.toString().padStart(4, '0')}`,
                cliente: venta.socio ? venta.socio.nombreCompleto : 'Público General',
                productos_resumen: obtenerResumenProductos(venta),
                total: parseFloat(venta.total),
                fecha_hora: venta.fechaVenta,
                metodo_pago: obtenerMetodoPago(venta),
                status: venta.status
            };
        });

        res.status(200).json({
            message: "Historial obtenido",
            dashboard_stats: dashboard_stats,
            summary_bar: summary_bar, 
            data: dataFormateada,
            pagination: { current_page: page, limit, total_records: totalRecords, total_pages: Math.ceil(totalRecords / limit) }
        });

    } catch (error) {
        console.error("Error al listar historial:", error);
        res.status(500).json({ error: "Error interno al obtener el historial." });
    }
};

// EXPORTAR VENTAS COMPLETAS (usa los mismos filtros del historial, sin paginación)
export const exportarVentas = async (req, res) => {
    try {
        const formato = String(req.query.formato || "XLSX").toUpperCase();

        if (req.query.periodo === "Personalizado" && (!req.query.fecha_inicio || !req.query.fecha_fin)) {
            return res.status(400).json({ error: "Selecciona fecha inicio y fecha fin para exportar ventas personalizadas." });
        }

        const { whereClause, gteDate, lteDate } = construirFiltrosVentas(req.query);

        const ventas = await prisma.venta.findMany({
            where: whereClause,
            orderBy: { fechaVenta: "desc" },
            include: {
                socio: { select: { nombreCompleto: true, codigoSocio: true } },
                cajero: { select: { nombreCompleto: true } },
                detalles: {
                    include: {
                        producto: {
                            select: {
                                codigo: true,
                                nombre: true,
                                categoria: { select: { nombre: true } }
                            }
                        }
                    }
                },
                pagos: { include: { metodoPago: true } }
            }
        });

        const ventasExitosas = ventas.filter((venta) => venta.status === "exitosa");
        const totalVendido = ventasExitosas.reduce((acc, venta) => acc + formatoMoneda(venta.total), 0);
        const totalCancelado = ventas
            .filter((venta) => venta.status === "cancelada")
            .reduce((acc, venta) => acc + formatoMoneda(venta.total), 0);
        const piezasVendidas = ventasExitosas.reduce(
            (acc, venta) => acc + venta.detalles.reduce((sum, detalle) => sum + detalle.cantidad, 0),
            0
        );

        const rango = gteDate && lteDate
            ? `${fechaUTCADiaStr(gteDate)} a ${fechaUTCADiaStr(lteDate)}`
            : "Todo el histórico";
        const fechaArchivo = fechaUTCADiaStr(new Date());

        const metodosMap = new Map();
        const productosMap = new Map();
        const detalleRows = [];
        const ventasRows = ventas.map((venta) => {
            const cajero = venta.cajero?.nombreCompleto || "No registrado";
            const cliente = venta.socio
                ? `${venta.socio.nombreCompleto}${venta.socio.codigoSocio ? ` (${venta.socio.codigoSocio})` : ""}`
                : "Público General";
            const metodoPago = obtenerMetodoPago(venta);

            venta.pagos.forEach((pago) => {
                const metodo = pago.metodoPago?.nombre || "No registrado";
                const item = metodosMap.get(metodo) || { metodo, transacciones: 0, total: 0 };
                item.transacciones += 1;
                item.total += formatoMoneda(pago.monto);
                metodosMap.set(metodo, item);
            });

            venta.detalles.forEach((detalle) => {
                const categoria = detalle.producto?.categoria?.nombre || "Sin categoría";
                const codigo = detalle.codigoProducto || detalle.producto?.codigo || "";
                const producto = detalle.nombreProducto || detalle.producto?.nombre || "Producto";
                const productKey = `${codigo}-${producto}-${categoria}`;
                const productItem = productosMap.get(productKey) || {
                    codigo,
                    producto,
                    categoria,
                    unidades: 0,
                    ingresos: 0,
                    ganancia: 0,
                };
                productItem.unidades += detalle.cantidad;
                productItem.ingresos += formatoMoneda(detalle.subtotalLinea);
                productItem.ganancia += formatoMoneda(detalle.gananciaLinea);
                productosMap.set(productKey, productItem);

                detalleRows.push({
                    folio: `V-${venta.id.toString().padStart(4, "0")}`,
                    fecha: formatoFechaHoraLocal(venta.fechaVenta),
                    cliente,
                    cajero,
                    estado: venta.status,
                    codigo,
                    producto,
                    categoria,
                    cantidad: detalle.cantidad,
                    precioUnitario: formatoMoneda(detalle.precioUnitario),
                    subtotal: formatoMoneda(detalle.subtotalLinea),
                    ganancia: formatoMoneda(detalle.gananciaLinea),
                    metodoPago,
                });
            });

            return {
                folio: `V-${venta.id.toString().padStart(4, "0")}`,
                fecha: formatoFechaHoraLocal(venta.fechaVenta),
                cliente,
                cajero,
                estado: venta.status,
                productos: obtenerResumenProductos(venta),
                articulos: venta.detalles.reduce((acc, detalle) => acc + detalle.cantidad, 0),
                subtotal: formatoMoneda(venta.subtotal),
                descuento: formatoMoneda(venta.descuento),
                total: formatoMoneda(venta.total),
                metodoPago,
            };
        });

        const productosRows = Array.from(productosMap.values()).sort((a, b) => b.unidades - a.unidades);
        const metodosRows = Array.from(metodosMap.values()).sort((a, b) => b.total - a.total);

        if (formato === "CSV") {
            const headers = [
                "Folio", "Fecha", "Cliente", "Cajero", "Estado", "Código", "Producto",
                "Categoría", "Cantidad", "Precio Unitario", "Subtotal", "Ganancia", "Método Pago"
            ];
            const csvContent = [
                headers.map(csvCell).join(","),
                ...detalleRows.map((row) => [
                    row.folio, row.fecha, row.cliente, row.cajero, row.estado, row.codigo, row.producto,
                    row.categoria, row.cantidad, row.precioUnitario, row.subtotal, row.ganancia, row.metodoPago
                ].map(csvCell).join(","))
            ].join("\n");

            const buffer = Buffer.from(`\uFEFF${csvContent}`, "utf8");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="ventas_${fechaArchivo}.csv"`);
            res.setHeader("Content-Length", buffer.length);
            return res.status(200).send(buffer);
        }

        if (formato === "PDF") {
            const buffer = await new Promise((resolve, reject) => {
                const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });
                const chunks = [];
                doc.on("data", (chunk) => chunks.push(chunk));
                doc.on("end", () => resolve(Buffer.concat(chunks)));
                doc.on("error", reject);

                doc.fontSize(16).text("Reporte de Ventas", { align: "left" });
                doc.moveDown(0.3);
                doc.fontSize(9).fillColor("#555555").text(`Periodo: ${rango} | Generado: ${formatoFechaHoraLocal(new Date())}`);
                doc.moveDown();
                doc.fillColor("#000000").fontSize(10);
                doc.text(`Ventas exportadas: ${ventas.length}`);
                doc.text(`Ventas exitosas: ${ventasExitosas.length}`);
                doc.text(`Total vendido: $${totalVendido.toFixed(2)}`);
                doc.text(`Productos vendidos: ${piezasVendidas}`);
                doc.moveDown();

                doc.fontSize(11).text("Historial de ventas", { underline: true });
                doc.moveDown(0.4);
                ventasRows.forEach((venta) => {
                    if (doc.y > 560) {
                        doc.addPage();
                    }
                    doc.fontSize(8).text(
                        `${venta.folio} | ${venta.fecha} | ${venta.cliente} | ${venta.productos} | $${venta.total.toFixed(2)} | ${venta.metodoPago} | ${venta.estado}`,
                        { width: 720 }
                    );
                });

                doc.end();
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="ventas_${fechaArchivo}.pdf"`);
            res.setHeader("Content-Length", buffer.length);
            return res.status(200).send(buffer);
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Hexodus";
        workbook.created = new Date();

        const resumenSheet = workbook.addWorksheet("Resumen");
        resumenSheet.addRow(["Reporte", "Ventas"]);
        resumenSheet.addRow(["Periodo", rango]);
        resumenSheet.addRow(["Generado", formatoFechaHoraLocal(new Date())]);
        resumenSheet.addRow(["Búsqueda", req.query.search || "Sin búsqueda"]);
        resumenSheet.addRow(["Método de pago", req.query.metodo_pago || "Todos"]);
        resumenSheet.addRow([]);
        aplicarEstiloHeader(resumenSheet.addRow(["Indicador", "Valor"]));
        [
            ["Ventas exportadas", ventas.length],
            ["Ventas exitosas", ventasExitosas.length],
            ["Ventas canceladas", ventas.length - ventasExitosas.length],
            ["Total vendido", totalVendido],
            ["Total cancelado", totalCancelado],
            ["Productos vendidos", piezasVendidas],
        ].forEach(([label, value]) => {
            const row = resumenSheet.addRow([label, value]);
            if (String(label).includes("Total")) row.getCell(2).numFmt = '"$"#,##0.00';
        });
        ajustarColumnas(resumenSheet);

        const historialSheet = workbook.addWorksheet("Historial");
        aplicarEstiloHeader(historialSheet.addRow([
            "Folio", "Fecha / Hora", "Cliente", "Cajero", "Estado", "Productos", "Artículos",
            "Subtotal", "Descuento", "Total", "Método Pago"
        ]));
        ventasRows.forEach((venta) => {
            const row = historialSheet.addRow([
                venta.folio, venta.fecha, venta.cliente, venta.cajero, venta.estado, venta.productos,
                venta.articulos, venta.subtotal, venta.descuento, venta.total, venta.metodoPago
            ]);
            [8, 9, 10].forEach((cellIndex) => row.getCell(cellIndex).numFmt = '"$"#,##0.00');
        });
        historialSheet.views = [{ state: "frozen", ySplit: 1 }];
        historialSheet.autoFilter = "A1:K1";
        ajustarColumnas(historialSheet);

        const detalleSheet = workbook.addWorksheet("Detalle Productos");
        aplicarEstiloHeader(detalleSheet.addRow([
            "Folio", "Fecha", "Cliente", "Cajero", "Estado", "Código", "Producto", "Categoría",
            "Cantidad", "Precio Unitario", "Subtotal", "Ganancia", "Método Pago"
        ]));
        detalleRows.forEach((detalle) => {
            const row = detalleSheet.addRow([
                detalle.folio, detalle.fecha, detalle.cliente, detalle.cajero, detalle.estado,
                detalle.codigo, detalle.producto, detalle.categoria, detalle.cantidad,
                detalle.precioUnitario, detalle.subtotal, detalle.ganancia, detalle.metodoPago
            ]);
            [10, 11, 12].forEach((cellIndex) => row.getCell(cellIndex).numFmt = '"$"#,##0.00');
        });
        detalleSheet.views = [{ state: "frozen", ySplit: 1 }];
        detalleSheet.autoFilter = "A1:M1";
        ajustarColumnas(detalleSheet);

        const productosSheet = workbook.addWorksheet("Productos Vendidos");
        aplicarEstiloHeader(productosSheet.addRow(["Código", "Producto", "Categoría", "Unidades", "Ingresos", "Ganancia Estimada"]));
        productosRows.forEach((producto) => {
            const row = productosSheet.addRow([
                producto.codigo, producto.producto, producto.categoria, producto.unidades, producto.ingresos, producto.ganancia
            ]);
            [5, 6].forEach((cellIndex) => row.getCell(cellIndex).numFmt = '"$"#,##0.00');
        });
        productosSheet.views = [{ state: "frozen", ySplit: 1 }];
        productosSheet.autoFilter = "A1:F1";
        ajustarColumnas(productosSheet);

        const metodosSheet = workbook.addWorksheet("Métodos de Pago");
        aplicarEstiloHeader(metodosSheet.addRow(["Método", "Transacciones", "Total"]));
        metodosRows.forEach((metodo) => {
            const row = metodosSheet.addRow([metodo.metodo, metodo.transacciones, metodo.total]);
            row.getCell(3).numFmt = '"$"#,##0.00';
        });
        metodosSheet.views = [{ state: "frozen", ySplit: 1 }];
        ajustarColumnas(metodosSheet);

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="ventas_${fechaArchivo}.xlsx"`);
        res.setHeader("Content-Length", buffer.length);
        return res.status(200).send(Buffer.from(buffer));
    } catch (error) {
        console.error("Error al exportar ventas:", error);
        return res.status(500).json({ error: "Error interno al exportar ventas." });
    }
};

// OBTENER DETALLE DE UNA VENTA 
export const obtenerVenta = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de venta inválido." });
        }

        const venta = await prisma.venta.findUnique({
            where: { id: parseInt(id) },
            include: {
                socio: {
                    select: { nombreCompleto: true }
                },
                detalles: true,
                pagos: {
                    include: { metodoPago: true } 
                }
            }
        });

        if (!venta || venta.isDeleted) {
            return res.status(404).json({ error: "Venta no encontrada o eliminada." });
        }

        // Unir los nombres de los métodos para los detalles
        const metodoPago = venta.pagos.length > 0 
            ? venta.pagos.map(p => p.metodoPago.nombre).join(' + ') 
            : 'No registrado';
        const cantidadTotalArticulos = venta.detalles.reduce((acc, det) => acc + det.cantidad, 0);

        const productosFormateados = venta.detalles.map(detalle => ({
            id_detalle: detalle.id,
            nombre: detalle.nombreProducto,
            precio_unitario: parseFloat(detalle.precioUnitario),
            cantidad: detalle.cantidad,
            subtotal: parseFloat(detalle.subtotalLinea)
        }));

        const dataFormateada = {
            id_venta: venta.id,
            id_venta_str: `V-${venta.id.toString().padStart(4, '0')}`, 
            cliente: venta.socio ? venta.socio.nombreCompleto : 'Público General',
            fecha_hora: venta.fechaVenta,
            metodo_pago: metodoPago,
            status: venta.status,
            total: parseFloat(venta.total),
            total_articulos: cantidadTotalArticulos,
            productos: productosFormateados
        };

        res.status(200).json({
            message: "Detalle de venta obtenido correctamente.",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al obtener detalle de venta:", error);
        res.status(500).json({ error: "Error interno al obtener el detalle de la venta." });
    }
};

// CANCELAR VENTA (Con Trazabilidad Completa)
export const cancelarVenta = async (req, res) => {
    try {
        const { id } = req.params;
        const ventaId = parseInt(id);

        if (isNaN(ventaId)) {
            return res.status(400).json({ error: "ID de venta inválido." });
        }

        // 1. Buscamos la venta con detalles, pagos y nombres de métodos de pago
        const venta = await prisma.venta.findUnique({
            where: { id: ventaId },
            include: {
                detalles: true,
                pagos: {
                    include: { metodoPago: true } // Para saber el nombre (Efectivo, Tarjeta, etc.)
                },
                socio: true
            }
        });

        if (!venta) return res.status(404).json({ error: "Venta no encontrada." });
        if (venta.status === 'cancelada') return res.status(400).json({ error: "Esta venta ya fue cancelada previamente." });

        // VERIFICAR CAJA ABIERTA Y MISMO CORTE
        // Buscamos el movimiento de caja original de esta venta
        const movOriginal = await prisma.cajaMovimiento.findFirst({
            where: { referenciaTipo: 'venta', referenciaId: venta.id, tipo: 'ingreso' },
            include: { corte: true }
        });

        if (!movOriginal) throw new Error("UX_ERROR:No se encontró el registro original en caja.");
        if (movOriginal.corte.status === 'cerrado') {
            return res.status(403).json({ error: "No se puede cancelar: El corte de caja de esta venta ya fue cerrado." });
        }

        // 3. PROCESO ATÓMICO DE CANCELACIÓN
        await prisma.$transaction(async (tx) => {
            
            // A. Cambiar estatus de la venta (Sigue visible, pero cancelada)
            await tx.venta.update({
                where: { id: venta.id },
                data: { status: 'cancelada' }
            });

            // B. Reversión de Inventario
            for (const item of venta.detalles) {
                // Devolvemos al stock
                await tx.inventarioStock.update({
                    where: { productoId: item.productoId },
                    data: { cantidad: { increment: item.cantidad } }
                });

                // Dejamos rastro en movimientos de inventario
                await tx.inventarioMovimiento.create({
                    data: {
                        productoId: item.productoId,
                        tipo: 'IN', // Re-entrada
                        cantidad: item.cantidad,
                        referenciaTipo: 'venta',
                        referenciaId: venta.id,
                        usuarioId: req.user.id,
                        nota: `CANCELACIÓN VENTA #${venta.id} - Devolución de producto`
                    }
                });
            }

            // C. Reversión Contable en Caja (Movimiento por cada método de pago)
            let concepto = await tx.concepto.findFirst({ where: { nombre: 'Cancelación de Venta' } });
            if (!concepto) concepto = await tx.concepto.create({ data: { nombre: 'Cancelación de Venta', tipo: 'gasto' } });

            for (const pago of venta.pagos) {
                await tx.cajaMovimiento.create({
                    data: {
                        corteId: movOriginal.corteId,
                        usuarioId: req.user.id,
                        conceptoId: concepto.id,
                        tipo: 'gasto',
                        monto: parseFloat(pago.monto), // Esto garantiza que la suma matemática cuadre
                        referenciaTipo: 'venta',
                        referenciaId: venta.id,
                        nota: `[Pago: ID ${pago.metodoPagoId}] DEVOLUCIÓN - Cancelación Venta #${venta.id} ${venta.socio ? `(Socio: ${venta.socio.nombreCompleto})` : ''}`
                    }
                });
            }
        });

        // 4. Registrar en Bitácora de Auditoría
        await registrarLog({
            req,
            accion: 'cancelar',
            modulo: 'ventas',
            registroId: venta.id,
            detalles: `Venta #${venta.id} cancelada. Dinero devuelto a caja y productos regresados al stock.`
        });

        res.status(200).json({ message: "Venta cancelada exitosamente. Se han generado los movimientos de reversión en caja e inventario." });

    } catch (error) {
        console.error("Error al cancelar venta:", error);
        res.status(500).json({ error: error.message.includes("UX_ERROR") ? error.message.split(":")[1] : "Error al procesar la cancelación." });
    }
};
