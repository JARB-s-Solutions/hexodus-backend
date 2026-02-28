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


// LISTAR PRODUCTOS
export const listarProductos = async (req, res) => {
    try {
        const { search } = req.query;

        let whereClause = { isDeleted: false };

        // Buscador por nombre o código
        if (search) {
            whereClause.OR = [
                { nombre: { contains: search, mode: 'insensitive' } },
                { codigo: { contains: search, mode: 'insensitive' } }
            ];
        }

        const productos = await prisma.producto.findMany({
            where: whereClause,
            include: {
                categoria: true,
                stock: true // Traemos la tabla InventarioStock amarrada al producto
            },
            orderBy: { createdAt: 'desc' }
        });

        // Formatear para que el Frontend tenga la vida fácil
        const dataFormateada = productos.map(p => {
            const inventario = p.stock; // Extraemos el registro de stock
            const cantidadActual = inventario ? inventario.cantidad : 0;
            const minimo = inventario ? inventario.stockMinimo : 0;

            return {
                id: p.id,
                codigo: p.codigo,
                nombre: p.nombre,
                categoria: p.categoria ? p.categoria.nombre : 'Sin categoría',
                precio_compra: p.costo,
                precio_venta: p.precio,
                stock_actual: cantidadActual,
                alerta_stock: cantidadActual <= minimo, 
                status: p.status
            };
        });

        res.status(200).json({
            message: "Productos obtenidos",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al listar productos:", error);
        res.status(500).json({ error: "Error interno al listar los productos." });
    }
};