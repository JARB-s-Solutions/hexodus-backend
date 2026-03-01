import prisma from "../config/prisma.js";
import crypto from "crypto";

// REGISTRAR NUEVA VENTA (Punto de Venta)
export const crearVenta = async (req, res) => {
    try {
        const { socio_id, metodo_pago_id, productos } = req.body;

        // Validaciones iniciales
        if (!metodo_pago_id) {
            return res.status(400).json({ error: "Debes seleccionar un método de pago." });
        }
        if (!productos || productos.length === 0) {
            return res.status(400).json({ error: "El carrito de compras está vacío." });
        }

        // Verificar que la caja esté abierta
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (!cajaAbierta) {
            return res.status(403).json({ error: "Operación denegada: La caja está cerrada. Debes realizar la apertura de caja primero." });
        }

        // Extraer todos los IDs de los productos para buscarlos en la BD
        const productosIds = productos.map(p => parseInt(p.producto_id));

        // Traer la información real de la BD (Precios y Stock) por seguridad
        const productosDB = await prisma.producto.findMany({
            where: { id: { in: productosIds }, isDeleted: false },
            include: { stock: true }
        });

        if (productosDB.length !== productosIds.length) {
            return res.status(400).json({ error: "Uno o más productos no existen o están inactivos." });
        }

        // Calcular totales y verificar stock
        let totalVenta = 0;
        const detallesVenta = [];

        for (const itemFront of productos) {
            const prodDB = productosDB.find(p => p.id === parseInt(itemFront.producto_id));
            const cantidadVender = parseInt(itemFront.cantidad);

            // Verificar Stock
            const stockActual = prodDB.stock ? prodDB.stock.cantidad : 0;
            if (stockActual < cantidadVender) {
                return res.status(400).json({ 
                    error: `Stock insuficiente para '${prodDB.nombre}'. Disponibles: ${stockActual}` 
                });
            }

            // Calcular Precios y Ganancias de esta línea
            const precioVenta = parseFloat(prodDB.precio);
            const costoCompra = parseFloat(prodDB.costo || 0);
            const subtotalLinea = precioVenta * cantidadVender;
            const gananciaLinea = (precioVenta - costoCompra) * cantidadVender;

            totalVenta += subtotalLinea;

            // Armar el objeto para VentaDetalle
            detallesVenta.push({
                productoId: prodDB.id,
                codigoProducto: prodDB.codigo, // Guardamos copia por si el producto cambia en el futuro
                nombreProducto: prodDB.nombre,
                cantidad: cantidadVender,
                precioUnitario: precioVenta,
                costoUnitario: costoCompra,
                subtotalLinea: subtotalLinea,
                gananciaLinea: gananciaLinea
            });
        }

        // Transacción Maestra: Ejecutar todos los movimientos a la vez
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Crear la Venta Principal
            const nuevaVenta = await tx.venta.create({
                data: {
                    uuidVenta: crypto.randomUUID(),
                    usuarioId: req.user.id, // El cajero
                    socioId: socio_id ? parseInt(socio_id) : null, // Si es cliente de paso, queda null
                    status: 'exitosa',
                    subtotal: totalVenta,
                    descuento: 0, // Aquí podrías integrar lógica de descuentos después
                    total: totalVenta
                }
            });

            // Crear los Detalles de la Venta
            for (const detalle of detallesVenta) {
                await tx.ventaDetalle.create({
                    data: {
                        ventaId: nuevaVenta.id,
                        ...detalle
                    }
                });

                // Descontar del Inventario y dejar bitácora
                const stockActual = productosDB.find(p => p.id === detalle.productoId).stock;
                
                await tx.inventarioStock.update({
                    where: { productoId: detalle.productoId },
                    data: { cantidad: stockActual.cantidad - detalle.cantidad }
                });

                await tx.inventarioMovimiento.create({
                    data: {
                        productoId: detalle.productoId,
                        tipo: 'OUT',
                        cantidad: detalle.cantidad,
                        costoUnitario: detalle.costoUnitario,
                        referenciaTipo: 'venta',
                        referenciaId: nuevaVenta.id,
                        usuarioId: req.user.id,
                        nota: `Venta #${nuevaVenta.id}`
                    }
                });
            }

            // Registrar el Pago de la Venta
            await tx.ventaPago.create({
                data: {
                    ventaId: nuevaVenta.id,
                    metodoPagoId: parseInt(metodo_pago_id),
                    monto: totalVenta
                }
            });

            // Registrar INGRESO en la Caja
            let conceptoVenta = await tx.concepto.findFirst({ where: { nombre: 'Venta de Productos' } });
            if (!conceptoVenta) { // Crearlo si no existe
                conceptoVenta = await tx.concepto.create({ data: { nombre: 'Venta de Productos', tipo: 'ingreso' } });
            }

            await tx.cajaMovimiento.create({
                data: {
                    usuarioId: req.user.id,
                    conceptoId: conceptoVenta.id,
                    tipo: 'ingreso',
                    monto: totalVenta,
                    referenciaTipo: 'venta',
                    referenciaId: nuevaVenta.id,
                    nota: `Ingreso por Venta #${nuevaVenta.id}`
                }
            });

            return nuevaVenta;
        }, {
            maxWait: 5000,
            timeout: 20000 
        });

        res.status(201).json({
            message: "Venta procesada exitosamente.",
            data: { 
                venta_id: resultado.id, 
                total_cobrado: resultado.total 
            }
        });

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

            // Si el texto tiene números (ej. "V-0152" o "152"), intentamos buscar por ID también
            const numSearch = parseInt(search.replace(/\D/g, ''));
            if (!isNaN(numSearch)) {
                orConditions.push({ id: numSearch });
            }

            whereClause.OR = orConditions;
        }

        // Filtro por Periodo de Tiempo
        const hoy = new Date();
        let gteDate = null;
        let lteDate = null;

        if (periodo && periodo !== 'Todos') {
            gteDate = new Date(hoy);
            lteDate = new Date(hoy);
            
            gteDate.setHours(0, 0, 0, 0);
            lteDate.setHours(23, 59, 59, 999);

            switch (periodo) {
                case 'Ayer':
                    gteDate.setDate(gteDate.getDate() - 1);
                    lteDate.setDate(lteDate.getDate() - 1);
                    break;
                case 'Esta Semana':
                    const diaSemana = gteDate.getDay() || 7; // Lunes como primer día
                    gteDate.setDate(gteDate.getDate() - diaSemana + 1);
                    break;
                case 'Este Mes':
                    gteDate.setDate(1);
                    break;
                case 'Este Trimestre':
                    gteDate.setMonth(Math.floor(gteDate.getMonth() / 3) * 3, 1);
                    break;
                case 'Este Semestre':
                    gteDate.setMonth(gteDate.getMonth() < 6 ? 0 : 6, 1);
                    break;
                case 'Este Año':
                    gteDate.setMonth(0, 1);
                    break;
                case 'Personalizado':
                    if (fecha_inicio) gteDate = new Date(`${fecha_inicio}T00:00:00.000Z`);
                    if (fecha_fin) lteDate = new Date(`${fecha_fin}T23:59:59.999Z`);
                    break;
                // 'Hoy' usa los valores por defecto
            }

            if (gteDate || lteDate) {
                whereClause.fechaVenta = {};
                if (gteDate) whereClause.fechaVenta.gte = gteDate;
                if (lteDate) whereClause.fechaVenta.lte = lteDate;
            }
        }

        // EJECUCIÓN PARALELA
        const mesInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

        const [totalRecords, ventasPaginadas, aggregateFiltrado, ventasDelMes] = await Promise.all([
            // Contar cuántas ventas cumplen los filtros (para paginación)
            prisma.venta.count({ where: whereClause }),
            
            // Traer los datos exactos para la tabla (ya filtrados)
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

            // Sumar el Total de TODO lo filtrado 
            prisma.venta.aggregate({
                where: whereClause,
                _sum: { total: true }
            }),

            // Traer TODO el mes sin filtros 
            prisma.venta.findMany({
                where: { isDeleted: false, status: 'exitosa', fechaVenta: { gte: mesInicio } },
                include: { detalles: { select: { cantidad: true } } }
            })
        ]);

        // CÁLCULO DE KPIs SUPERIORES Y BARRA INFERIOR
        const hoyInicio = new Date(); hoyInicio.setHours(0, 0, 0, 0);
        const ayerInicio = new Date(hoyInicio); ayerInicio.setDate(ayerInicio.getDate() - 1);
        const ayerFin = new Date(ayerInicio); ayerFin.setHours(23, 59, 59, 999);

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

        // Datos para la BARRA DE RESUMEN INFERIOR
        let formatoFechaRango = "Todo el histórico";
        if (gteDate && lteDate) {
            formatoFechaRango = `${gteDate.toISOString().split('T')[0]} a ${lteDate.toISOString().split('T')[0]}`;
        } else if (periodo === 'Hoy') {
            formatoFechaRango = "Ventas de Hoy";
        }

        const summary_bar = {
            rango: formatoFechaRango,
            total_filtrado: aggregateFiltrado._sum.total ? parseFloat(aggregateFiltrado._sum.total) : 0,
            ventas_count: totalRecords
        };

        // FORMATEO DE LA TABLA
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

        // Buscar la venta con todos sus detalles, pagos y la info del socio
        const venta = await prisma.venta.findUnique({
            where: { id: parseInt(id) },
            include: {
                socio: {
                    select: { nombreCompleto: true }
                },
                detalles: true,
                pagos: {
                    include: { metodoPago: true } // Para sacar si fue Efectivo, Tarjeta, etc.
                }
            }
        });

        if (!venta || venta.isDeleted) {
            return res.status(404).json({ error: "Venta no encontrada o eliminada." });
        }

        // Extraer el método de pago (asumimos el primero, ya que suele ser un solo pago)
        const metodoPago = venta.pagos.length > 0 ? venta.pagos[0].metodoPago.nombre : 'No registrado';

        // Calcular la cantidad total de artículos para el encabezado "PRODUCTOS"
        const cantidadTotalArticulos = venta.detalles.reduce((acc, det) => acc + det.cantidad, 0);

        // Mapear la lista de productos
        const productosFormateados = venta.detalles.map(detalle => ({
            id_detalle: detalle.id,
            nombre: detalle.nombreProducto,
            precio_unitario: parseFloat(detalle.precioUnitario),
            cantidad: detalle.cantidad,
            subtotal: parseFloat(detalle.subtotalLinea)
        }));

        // Formatear la respuesta lista para inyectar en el Modal
        const dataFormateada = {
            id_venta: venta.id,
            id_venta_str: `V-${venta.id.toString().padStart(4, '0')}`, // Ej: V-0152
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