import prisma from "../config/prisma.js";
import crypto from "crypto";

// CREAR PRODUCTO NUEVO (Con Stock Inicial)
export const crearProducto = async (req, res) => {
    try {
        const {
            nombre,
            codigo,
            categoria_id,
            marca,
            precio_compra, // Costo para el gimnasio
            precio_venta,  // Precio para el socio
            stock_inicial,
            stock_minimo,
            descripcion
        } = req.body;

        // Validaciones básicas
        if (!nombre || !codigo || !categoria_id || !precio_compra || !precio_venta) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }

        const codigoExiste = await prisma.producto.findUnique({ where: { codigo: codigo } });
        if (codigoExiste && !codigoExiste.isDeleted) {
            return res.status(400).json({ error: "Ya existe un producto activo con este código." });
        }

        // Transacción Maestra para Producto + Stock + Historial
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Crear el Producto en el catálogo
            const nuevoProducto = await tx.producto.create({
                data: {
                    uuidProducto: crypto.randomUUID(),
                    codigo: codigo,
                    nombre: nombre,
                    categoriaId: parseInt(categoria_id),
                    marca: marca || null,
                    precio: parseFloat(precio_venta),
                    costo: parseFloat(precio_compra),
                    descripcion: descripcion || null,
                }
            });

            const sInicial = parseInt(stock_inicial) || 0;
            const sMinimo = parseInt(stock_minimo) || 0;

            // Crear su conteo en el almacén (InventarioStock)
            await tx.inventarioStock.create({
                data: {
                    productoId: nuevoProducto.id,
                    cantidad: sInicial,
                    stockMinimo: sMinimo
                }
            });

            // Si se puso stock inicial > 0, registrar el movimiento de entrada
            if (sInicial > 0) {
                await tx.inventarioMovimiento.create({
                    data: {
                        productoId: nuevoProducto.id,
                        tipo: 'IN', // Entrada
                        cantidad: sInicial,
                        costoUnitario: parseFloat(precio_compra),
                        referenciaTipo: 'ajuste', // Es un ajuste inicial, no una compra a proveedor
                        usuarioId: req.user.id,
                        nota: "Inventario Inicial al crear producto"
                    }
                });
            }

            return nuevoProducto;
        });

        res.status(201).json({
            message: "Producto creado exitosamente.",
            data: { id: resultado.id, codigo: resultado.codigo }
        });

    } catch (error) {
        console.error("Error al crear producto:", error);
        res.status(500).json({ error: "Error interno al guardar el producto." });
    }
};



// LISTAR PRODUCTOS (Dashboard y Paginación)
export const listarProductos = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        const { search, categoria_id, estado } = req.query;

        // Filtros Dinámicos para la Tabla
        let whereClause = { isDeleted: false };

        if (search) {
            whereClause.OR = [
                { nombre: { contains: search, mode: 'insensitive' } },
                { codigo: { contains: search, mode: 'insensitive' } },
                { marca: { contains: search, mode: 'insensitive' } } // Permite buscar por marca
            ];
        }

        if (categoria_id && categoria_id !== 'Todas') {
            whereClause.categoriaId = parseInt(categoria_id);
        }

        if (estado && estado !== 'Todos') {
            whereClause.status = estado; // 'activo' o 'inactivo'
        }

        const hoy = new Date();
        const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

        // Ejecución Paralela (Paginación + Tabla + KPIs Globales)
        const [totalRecords, productosRaw, productosGlobales, totalCategorias] = await Promise.all([
            prisma.producto.count({ where: whereClause }), // Total para la paginación
            prisma.producto.findMany({ // Datos de la tabla actual
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    categoria: true,
                    stock: true
                }
            }),
            prisma.producto.findMany({ // Consulta ligera de TODOS para sacar los totales matemáticos
                where: { isDeleted: false },
                select: {
                    createdAt: true,
                    costo: true,
                    stock: { select: { cantidad: true, stockMinimo: true } }
                }
            }),
            prisma.categoriaProducto.count() // Total de categorías registradas
        ]);

        // Cálculo de las Tarjetas (KPIs) del Dashboard
        let totalProductos = productosGlobales.length;
        let nuevosEsteMes = 0;
        let stockBajo = 0;
        let valorTotalInventario = 0;

        productosGlobales.forEach(p => {
            // Tarjeta 1: Nuevos este mes
            if (p.createdAt >= inicioMes) nuevosEsteMes++;
            
            const cantidad = p.stock ? p.stock.cantidad : 0;
            const minimo = p.stock ? p.stock.stockMinimo : 0;
            
            // Tarjeta 2: Alertas de Stock Bajo
            if (cantidad <= minimo) stockBajo++;
            
            // Tarjeta 3: Valor de tu inventario (Cantidad física * Costo de compra)
            valorTotalInventario += (cantidad * parseFloat(p.costo || 0));
        });

        const dashboard_stats = {
            total_productos: {
                valor: totalProductos,
                etiqueta: `+${nuevosEsteMes} este mes`
            },
            stock_bajo: {
                valor: stockBajo,
                etiqueta: "Requieren reabastecimiento"
            },
            valor_total: {
                valor: valorTotalInventario, 
                etiqueta: "Inventario completo"
            },
            categorias: {
                valor: totalCategorias,
                etiqueta: "Tipos de productos"
            }
        };

        // Formatear datos para la tabla del UI
        const dataFormateada = productosRaw.map(p => {
            const inventario = p.stock;
            const cantidadActual = inventario ? inventario.cantidad : 0;
            const minimo = inventario ? inventario.stockMinimo : 0;

            return {
                id: p.id,
                codigo: p.codigo,
                nombre: p.nombre,
                marca: p.marca || 'N/A',
                categoria: p.categoria ? p.categoria.nombre : 'Sin categoría',
                precio_compra: parseFloat(p.costo),
                precio_venta: parseFloat(p.precio),
                stock_actual: cantidadActual,
                alerta_stock: cantidadActual <= minimo, // true/false para que el UI pinte de rojo el stock
                status: p.status
            };
        });

        // Respuesta Final
        res.status(200).json({
            message: "Lista de productos obtenida correctamente",
            dashboard_stats: dashboard_stats,
            data: dataFormateada,
            pagination: {
                current_page: page,
                limit: limit,
                total_records: totalRecords,
                total_pages: Math.ceil(totalRecords / limit)
            }
        });

    } catch (error) {
        console.error("Error al listar productos:", error);
        res.status(500).json({ error: "Error interno al obtener la lista de productos." });
    }
};


// OBTENER DETALLE DE UN PRODUCTO (Por ID)
export const obtenerProducto = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de producto inválido." });
        }

        // Buscar el producto con su categoría y su stock
        const producto = await prisma.producto.findUnique({
            where: { id: parseInt(id) },
            include: {
                categoria: true,
                stock: true
            }
        });

        if (!producto || producto.isDeleted) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        // Extraer valores de stock de forma segura
        const inventario = producto.stock;
        const cantidadActual = inventario ? inventario.cantidad : 0;
        const stockMinimo = inventario ? inventario.stockMinimo : 0;
        const ultimaActualizacion = inventario ? inventario.updatedAt : producto.createdAt;

        // Extraer precios
        const precioVenta = parseFloat(producto.precio || 0);
        const precioCompra = parseFloat(producto.costo || 0);

        // CÁLCULO DE MARGEN DE GANANCIA 
        const margenMonetario = precioVenta - precioCompra;
        let margenPorcentaje = 0;
        
        if (precioCompra > 0) {
            // Se calcula qué porcentaje representa la ganancia respecto al costo original
            margenPorcentaje = (margenMonetario / precioCompra) * 100;
        } else if (precioVenta > 0) {
            // Si te costó $0 (ej. un regalo de proveedor) es 100% ganancia
            margenPorcentaje = 100; 
        }

        // Formatear la respuesta
        const dataFormateada = {
            // Header
            id: producto.id,
            codigo: producto.codigo,
            nombre: producto.nombre,
            marca: producto.marca || 'Sin marca registrada',
            categoria: producto.categoria ? producto.categoria.nombre : 'Sin categoría',
            status: producto.status, // "activo" o "inactivo" para pintar el badge verde
            
            // Tarjetas de Precios y Margen
            precio_venta: precioVenta,
            precio_compra: precioCompra,
            margen_monetario: Number(margenMonetario.toFixed(2)),
            margen_porcentaje: Number(margenPorcentaje.toFixed(1)), // Ej: 66.8
            
            // Tarjeta de Stock
            stock_actual: cantidadActual,
            stock_minimo: stockMinimo,
            
            // Footer
            ultima_actualizacion: ultimaActualizacion,
            descripcion: producto.descripcion || 'Sin descripción disponible.'
        };

        res.status(200).json({
            message: "Detalle del producto obtenido correctamente.",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al obtener detalle del producto:", error);
        res.status(500).json({ error: "Error interno al obtener el producto." });
    }
};


// ACTUALIZAR PRODUCTO (PUT)
export const actualizarProducto = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre,
            codigo,
            categoria_id,
            marca,
            precio_compra,
            precio_venta,
            stock_actual, // En el UI dice "Stock Inicial", pero aquí recibiremos la cantidad nueva
            stock_minimo,
            descripcion
        } = req.body;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de producto inválido." });
        }

        const productoId = parseInt(id);

        // Verificar si el producto existe
        const productoExistente = await prisma.producto.findUnique({
            where: { id: productoId },
            include: { stock: true }
        });

        if (!productoExistente || productoExistente.isDeleted) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        // Validar que si cambian el código, no choque con uno que ya exista
        if (codigo && codigo !== productoExistente.codigo) {
            const codigoOcupado = await prisma.producto.findUnique({ where: { codigo } });
            if (codigoOcupado && !codigoOcupado.isDeleted) {
                return res.status(400).json({ error: "El código ingresado ya está en uso por otro producto." });
            }
        }

        // Transacción para actualizar Producto + Stock + Historial (si hubo ajuste)
        await prisma.$transaction(async (tx) => {
            
            // Actualizar la información del Catálogo
            await tx.producto.update({
                where: { id: productoId },
                data: {
                    nombre: nombre || productoExistente.nombre,
                    codigo: codigo || productoExistente.codigo,
                    categoriaId: categoria_id ? parseInt(categoria_id) : productoExistente.categoriaId,
                    marca: marca !== undefined ? marca : productoExistente.marca,
                    precio: precio_venta !== undefined ? parseFloat(precio_venta) : productoExistente.precio,
                    costo: precio_compra !== undefined ? parseFloat(precio_compra) : productoExistente.costo,
                    descripcion: descripcion !== undefined ? descripcion : productoExistente.descripcion,
                }
            });

            // Procesar el Inventario (Mínimos y Ajustes manuales)
            const inventarioActual = productoExistente.stock;
            let dataStock = {};
            
            if (stock_minimo !== undefined) {
                dataStock.stockMinimo = parseInt(stock_minimo);
            }

            const nuevaCantidad = stock_actual !== undefined ? parseInt(stock_actual) : null;
            let huboAjuste = false;
            let diferencia = 0;

            // Si mandaron un stock y es distinto al que ya teníamos guardado...
            if (nuevaCantidad !== null && inventarioActual && nuevaCantidad !== inventarioActual.cantidad) {
                dataStock.cantidad = nuevaCantidad;
                diferencia = nuevaCantidad - inventarioActual.cantidad; // Ej: 80 - 85 = -5
                huboAjuste = true;
            }

            if (Object.keys(dataStock).length > 0) {
                await tx.inventarioStock.update({
                    where: { productoId: productoId },
                    data: dataStock
                });
            }

            // Si el administrador alteró el stock a mano, dejamos un rastro de auditoría
            if (huboAjuste) {
                await tx.inventarioMovimiento.create({
                    data: {
                        productoId: productoId,
                        tipo: diferencia > 0 ? 'AJUSTE' : 'OUT', // Si subió es Ajuste positivo, si bajó es Salida (OUT)
                        cantidad: Math.abs(diferencia),
                        costoUnitario: parseFloat(precio_compra || productoExistente.costo),
                        referenciaTipo: 'ajuste', // Etiqueta clave para que el contador sepa que no fue una venta
                        usuarioId: req.user.id,
                        nota: `Ajuste manual desde edición. Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia}`
                    }
                });
            }
        });

        res.status(200).json({
            message: "Producto actualizado correctamente."
        });

    } catch (error) {
        console.error("Error al actualizar producto:", error);
        res.status(500).json({ error: "Error interno al actualizar el producto." });
    }
};


// AJUSTAR STOCK RÁPIDO (Suma o Resta Manual)
export const ajustarStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { cantidad_ajuste, nota } = req.body; 

        // Validar que manden un número
        if (isNaN(id) || cantidad_ajuste === undefined) {
            return res.status(400).json({ error: "Debes enviar la cantidad a ajustar." });
        }

        const productoId = parseInt(id);
        const ajuste = parseInt(cantidad_ajuste);

        if (ajuste === 0) {
            return res.status(400).json({ error: "La cantidad a ajustar no puede ser cero." });
        }

        // Buscar el producto y su inventario actual
        const producto = await prisma.producto.findUnique({
            where: { id: productoId },
            include: { stock: true }
        });

        if (!producto || producto.isDeleted) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        const stockActual = producto.stock ? producto.stock.cantidad : 0;
        const nuevoStock = stockActual + ajuste;

        // Regla de Negocio: El stock no puede ser negativo
        if (nuevoStock < 0) {
            return res.status(400).json({ 
                error: `No puedes reducir ${Math.abs(ajuste)} unidades. Solo tienes ${stockActual} en stock.` 
            });
        }

        // 3. Transacción: Actualizar número y guardar historial
        await prisma.$transaction(async (tx) => {
            // Actualizar el stock
            if (producto.stock) {
                await tx.inventarioStock.update({
                    where: { productoId: productoId },
                    data: { cantidad: nuevoStock }
                });
            } else {
                // Por si el producto fue creado sin stock base
                await tx.inventarioStock.create({
                    data: { productoId: productoId, cantidad: nuevoStock }
                });
            }

            // Registrar en la bitácora (InventarioMovimiento)
            await tx.inventarioMovimiento.create({
                data: {
                    productoId: productoId,
                    // Si sumaron es AJUSTE (Entrada), si restaron es OUT (Salida/Pérdida)
                    tipo: ajuste > 0 ? 'AJUSTE' : 'OUT', 
                    cantidad: Math.abs(ajuste), // Guardamos el valor en positivo
                    costoUnitario: producto.costo || 0,
                    referenciaTipo: 'ajuste',
                    usuarioId: req.user.id,
                    nota: nota || `Ajuste rápido de stock: ${ajuste > 0 ? '+' : ''}${ajuste}`
                }
            });
        });

        res.status(200).json({
            message: "Stock ajustado correctamente.",
            data: { 
                stock_anterior: stockActual, 
                nuevo_stock: nuevoStock 
            }
        });

    } catch (error) {
        console.error("Error al ajustar stock:", error);
        res.status(500).json({ error: "Error interno al procesar el ajuste." });
    }
};



// ELIMINAR PRODUCTO (Borrado Lógico)
export const eliminarProducto = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de producto inválido." });
        }

        const productoId = parseInt(id);

        // Verificar si el producto existe y si no está ya eliminado
        const productoExistente = await prisma.producto.findUnique({
            where: { id: productoId }
        });

        if (!productoExistente || productoExistente.isDeleted) {
            return res.status(404).json({ error: "Producto no encontrado o ya fue eliminado." });
        }

        // Realizar el borrado lógico
        await prisma.producto.update({
            where: { id: productoId },
            data: {
                isDeleted: true,
                status: 'inactivo' // Lo pasamos a inactivo por seguridad
            }
        });

        res.status(200).json({
            message: "Producto eliminado correctamente del inventario."
        });

    } catch (error) {
        console.error("Error al eliminar producto:", error);
        res.status(500).json({ error: "Error interno al intentar eliminar el producto." });
    }
};