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