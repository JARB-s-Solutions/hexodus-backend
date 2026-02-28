import prisma from "../config/prisma.js";

// REGISTRAR COMPRA DE REABASTECIMIENTO (Múltiples productos)
export const registrarCompra = async (req, res) => {
    try {
        const { fecha, proveedor_nombre, tipo_pago_id, productos } = req.body;

        // Validaciones básicas
        if (!productos || productos.length === 0) {
            return res.status(400).json({ error: "Debes agregar al menos un producto a la compra." });
        }

        if (!proveedor_nombre) {
            return res.status(400).json({ error: "El nombre del proveedor es obligatorio." });
        }

        // Verificar que la caja esté abierta
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (!cajaAbierta) {
            return res.status(403).json({ error: "Operación denegada: La caja está cerrada. Debes realizar la apertura de caja primero." });
        }

        // Calcular el total de la compra desde el Backend
        let totalCompra = 0;
        productos.forEach(p => {
            totalCompra += (parseInt(p.cantidad) * parseFloat(p.costo_unitario));
        });

        // Transacción Maestra
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Buscar o crear el Proveedor
            let proveedor = await tx.proveedor.findFirst({
                where: { nombre: proveedor_nombre.trim() }
            });

            if (!proveedor) {
                proveedor = await tx.proveedor.create({
                    data: { nombre: proveedor_nombre.trim() }
                });
            }

            // Registrar la Compra Principal (Cabecera)
            const nuevaCompra = await tx.compra.create({
                data: {
                    usuarioId: req.user.id,
                    proveedorId: proveedor.id,
                    fechaCompra: fecha ? new Date(fecha) : new Date(),
                    total: totalCompra,
                    status: 'registrada'
                }
            });

            // Iterar sobre cada producto del "carrito"
            for (const item of productos) {
                const cantidadItem = parseInt(item.cantidad);
                const costoItem = parseFloat(item.costo_unitario);
                const subtotalItem = cantidadItem * costoItem;

                // Crear el Detalle de la Compra
                await tx.compraDetalle.create({
                    data: {
                        compraId: nuevaCompra.id,
                        productoId: parseInt(item.producto_id),
                        cantidad: cantidadItem,
                        costoUnitario: costoItem,
                        subtotal: subtotalItem
                    }
                });

                // Sumar el Stock Físico
                const stockActual = await tx.inventarioStock.findUnique({
                    where: { productoId: parseInt(item.producto_id) }
                });

                if (stockActual) {
                    await tx.inventarioStock.update({
                        where: { productoId: parseInt(item.producto_id) },
                        data: { cantidad: stockActual.cantidad + cantidadItem }
                    });
                } else {
                    // Por si el producto de alguna forma no tenía registro de stock
                    await tx.inventarioStock.create({
                        data: { productoId: parseInt(item.producto_id), cantidad: cantidadItem }
                    });
                }

                // Dejar rastro en el Historial de Movimientos
                await tx.inventarioMovimiento.create({
                    data: {
                        productoId: parseInt(item.producto_id),
                        tipo: 'IN',
                        cantidad: cantidadItem,
                        costoUnitario: costoItem,
                        referenciaTipo: 'compra',
                        referenciaId: nuevaCompra.id,
                        usuarioId: req.user.id,
                        nota: `Compra a proveedor ${proveedor.nombre}`
                    }
                });
            }

            // Registrar EGRESO en la Caja
            let conceptoCompra = await tx.concepto.findFirst({ where: { nombre: 'Compra a Proveedores' } });
            if (!conceptoCompra) {
                conceptoCompra = await tx.concepto.create({ data: { nombre: 'Compra a Proveedores', tipo: 'gasto' } });
            }

            await tx.cajaMovimiento.create({
                data: {
                    usuarioId: req.user.id,
                    conceptoId: conceptoCompra.id,
                    tipo: 'gasto', 
                    monto: totalCompra,
                    referenciaTipo: 'otro',
                    referenciaId: nuevaCompra.id,
                    nota: `Pago de compra #${nuevaCompra.id} a ${proveedor.nombre}`
                }
            });

            return nuevaCompra;
        }, {
            maxWait: 5000,
            timeout: 20000 
        });

        res.status(201).json({
            message: "Compra registrada y stock actualizado exitosamente.",
            data: { compra_id: resultado.id, total: resultado.total }
        });

    } catch (error) {
        console.error("Error al registrar compra:", error);
        res.status(500).json({ error: "Error interno al procesar la compra." });
    }
};