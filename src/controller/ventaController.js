import prisma from "../config/prisma.js";
import crypto from "crypto";
import { ahoraEnMerida, localAUTC, fechaStrAInicio, fechaStrAFin, fechaUTCADiaStr } from "../utils/timezone.js";


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

                await tx.ventaPago.create({
                    data: { ventaId: nuevaVenta.id, metodoPagoId: parseInt(pago.metodo_pago_id), monto: montoPago }
                });

                await tx.cajaMovimiento.create({
                    data: {
                        corteId: cajaAbierta.id, usuarioId: req.user.id, conceptoId: conceptoVenta.id, tipo: 'ingreso',
                        monto: montoPago, referenciaTipo: 'venta', referenciaId: nuevaVenta.id,
                        nota: `[Pago: ID ${pago.metodo_pago_id}] Parcialidad Venta #${nuevaVenta.id}`
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

        const { search, periodo, fecha_inicio, fecha_fin, metodo_pago } = req.query;

        // LÓGICA DE FILTROS
        let whereClause = { isDeleted: false, status: 'exitosa' };

        // Filtro por Método de Pago
        if (metodo_pago && metodo_pago !== 'Todos los Metodos') {
            whereClause.pagos = {
                some: {
                    metodoPago: { nombre: { equals: metodo_pago, mode: 'insensitive' } }
                }
            };
        }

        // Filtro por Búsqueda (ID, Cliente o Producto)
        if (search) {
            let orConditions = [
                { socio: { nombreCompleto: { contains: search, mode: 'insensitive' } } },
                { detalles: { some: { nombreProducto: { contains: search, mode: 'insensitive' } } } }
            ];

            const numSearch = parseInt(search.replace(/\D/g, ''));
            if (!isNaN(numSearch)) {
                orConditions.push({ id: numSearch });
            }

            whereClause.OR = orConditions;
        }

        // Filtro por Periodo de Tiempo
        const { year: _y, month: _m, day: _d } = ahoraEnMerida();
        let gteDate = null;
        let lteDate = null;

        if (periodo && periodo !== 'Todos') {
            gteDate = localAUTC(_y, _m, _d, 0, 0, 0, 0);
            lteDate = localAUTC(_y, _m, _d, 23, 59, 59, 999);

            switch (periodo) {
                case 'Ayer':
                    gteDate = localAUTC(_y, _m, _d - 1, 0, 0, 0, 0);
                    lteDate = localAUTC(_y, _m, _d - 1, 23, 59, 59, 999);
                    break;
                case 'Esta Semana': {
                    const dowISO = new Date(Date.UTC(_y, _m - 1, _d)).getUTCDay() || 7;
                    gteDate = localAUTC(_y, _m, _d - dowISO + 1, 0, 0, 0, 0);
                    break;
                }
                case 'Este Mes':
                    gteDate = localAUTC(_y, _m, 1, 0, 0, 0, 0);
                    break;
                case 'Este Trimestre':
                    gteDate = localAUTC(_y, Math.floor((_m - 1) / 3) * 3 + 1, 1, 0, 0, 0, 0);
                    break;
                case 'Este Semestre':
                    gteDate = localAUTC(_y, _m <= 6 ? 1 : 7, 1, 0, 0, 0, 0);
                    break;
                case 'Este Año':
                    gteDate = localAUTC(_y, 1, 1, 0, 0, 0, 0);
                    break;
                case 'Personalizado':
                    if (fecha_inicio) gteDate = fechaStrAInicio(fecha_inicio);
                    if (fecha_fin) lteDate = fechaStrAFin(fecha_fin);
                    break;
            }

            if (gteDate || lteDate) {
                whereClause.fechaVenta = {};
                if (gteDate) whereClause.fechaVenta.gte = gteDate;
                if (lteDate) whereClause.fechaVenta.lte = lteDate;
            }
        }

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
                where: whereClause,
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
            let resumenProductos = 'Sin productos';
            if (venta.detalles.length > 0) {
                const primer = venta.detalles[0].nombreProducto;
                const extras = venta.detalles.length - 1;
                resumenProductos = extras > 0 ? `${primer} +${extras} mas` : primer;
            }

            return {
                id: venta.id,
                id_venta: `V-${venta.id.toString().padStart(4, '0')}`,
                cliente: venta.socio ? venta.socio.nombreCompleto : 'Público General',
                productos_resumen: resumenProductos,
                total: parseFloat(venta.total),
                fecha_hora: venta.fechaVenta,
                metodo_pago: venta.pagos.length > 0 ? venta.pagos[0].metodoPago.nombre : 'No registrado',
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

        const metodoPago = venta.pagos.length > 0 ? venta.pagos[0].metodoPago.nombre : 'No registrado';
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