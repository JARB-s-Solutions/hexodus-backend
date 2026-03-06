import prisma from "../config/prisma.js";

// --- UTILIDADES DE VALIDACIÓN ---
const PREFIJO_REGEX = /^[A-Z0-9]{2,6}$/;
const COLOR_REGEX = /^#[0-9A-F]{6}$/i;

const validarDatosCategoria = (prefijo, color, estado) => {
    let errores = [];
    
    if (prefijo && !PREFIJO_REGEX.test(prefijo)) {
        errores.push({ field: "prefijo", error: "El prefijo solo puede contener letras mayúsculas y números (2-6 caracteres)" });
    }
    if (color && !COLOR_REGEX.test(color)) {
        errores.push({ field: "color", error: "El color debe estar en formato hexadecimal (#RRGGBB)" });
    }
    if (estado && !['activa', 'inactiva'].includes(estado)) {
        errores.push({ field: "estado", error: "El estado debe ser 'activa' o 'inactiva'" });
    }
    
    return errores;
};

// OBTENER TODAS LAS CATEGORÍAS (GET)
export const listarCategorias = async (req, res) => {
    try {
        const categorias = await prisma.categoriaProducto.findMany({
            include: {
                _count: {
                    // Contamos los productos que no estén borrados y que estén activos
                    select: { productos: { where: { isDeleted: false, status: 'activo' } } } 
                }
            },
            orderBy: { nombre: 'asc' }
        });

        const dataFormateada = categorias.map(cat => ({
            id: cat.id,
            nombre: cat.nombre,
            prefijo: cat.prefijo,
            color: cat.color,
            descripcion: cat.descripcion,
            estado: cat.estado,
            created_at: cat.createdAt,
            updated_at: cat.updatedAt,
            total_productos: cat._count.productos
        }));

        res.status(200).json({
            message: "Categorías obtenidas",
            data: dataFormateada
        });
    } catch (error) {
        console.error("Error al listar categorías:", error);
        res.status(500).json({ error: "Error interno del servidor", status: 500 });
    }
};

// CREAR CATEGORÍA (POST)
export const crearCategoria = async (req, res) => {
    try {
        const { nombre, prefijo, color, descripcion, estado } = req.body;

        if (!nombre || nombre.trim().length < 3) {
            return res.status(400).json({ error: "El nombre es requerido y debe tener mínimo 3 caracteres", field: "nombre", status: 400 });
        }

        const errores = validarDatosCategoria(prefijo, color, estado);
        if (errores.length > 0) return res.status(400).json({ ...errores[0], status: 400 });

        const existeNombre = await prisma.categoriaProducto.findUnique({ where: { nombre: nombre.trim() } });
        if (existeNombre) return res.status(409).json({ error: "Ya existe una categoría con ese nombre", field: "nombre", status: 409 });

        if (prefijo) {
            const existePrefijo = await prisma.categoriaProducto.findUnique({ where: { prefijo } });
            if (existePrefijo) return res.status(409).json({ error: "Ya existe una categoría con ese prefijo", field: "prefijo", status: 409 });
        }

        const nuevaCategoria = await prisma.categoriaProducto.create({
            data: {
                nombre: nombre.trim(),
                prefijo: prefijo || null,
                color: color?.toUpperCase() || '#6B7280',
                descripcion: descripcion || null,
                estado: estado || 'activa'
            }
        });

        res.status(201).json({
            message: "Categoría creada exitosamente",
            data: { ...nuevaCategoria, created_at: nuevaCategoria.createdAt, updated_at: nuevaCategoria.updatedAt }
        });
    } catch (error) {
        console.error("Error al crear categoría:", error);
        res.status(500).json({ error: "Error interno del servidor", status: 500 });
    }
};

// ACTUALIZAR CATEGORÍA (PUT)
export const actualizarCategoria = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, prefijo, color, descripcion, estado } = req.body;

        const categoriaActual = await prisma.categoriaProducto.findUnique({ where: { id: parseInt(id) } });
        if (!categoriaActual) return res.status(404).json({ error: "Categoría no encontrada", status: 404 });

        const errores = validarDatosCategoria(prefijo, color, estado);
        if (errores.length > 0) return res.status(400).json({ ...errores[0], status: 400 });

        if (nombre && nombre.trim() !== categoriaActual.nombre) {
            const existeNombre = await prisma.categoriaProducto.findUnique({ where: { nombre: nombre.trim() } });
            if (existeNombre) return res.status(409).json({ error: "Ya existe una categoría con ese nombre", field: "nombre", status: 409 });
        }

        if (prefijo && prefijo !== categoriaActual.prefijo) {
            const existePrefijo = await prisma.categoriaProducto.findUnique({ where: { prefijo } });
            if (existePrefijo) return res.status(409).json({ error: "Ya existe una categoría con ese prefijo", field: "prefijo", status: 409 });
        }

        const categoriaActualizada = await prisma.categoriaProducto.update({
            where: { id: parseInt(id) },
            data: {
                nombre: nombre !== undefined ? nombre.trim() : categoriaActual.nombre,
                prefijo: prefijo !== undefined ? prefijo : categoriaActual.prefijo,
                color: color ? color.toUpperCase() : categoriaActual.color,
                descripcion: descripcion !== undefined ? descripcion : categoriaActual.descripcion,
                estado: estado || categoriaActual.estado
            }
        });

        res.status(200).json({
            message: "Categoría actualizada exitosamente",
            data: { ...categoriaActualizada, created_at: categoriaActualizada.createdAt, updated_at: categoriaActualizada.updatedAt }
        });
    } catch (error) {
        console.error("Error al actualizar categoría:", error);
        res.status(500).json({ error: "Error interno del servidor", status: 500 });
    }
};

// ELIMINAR CATEGORÍA (DELETE)
export const eliminarCategoria = async (req, res) => {
    try {
        const { id } = req.params;

        const categoria = await prisma.categoriaProducto.findUnique({ where: { id: parseInt(id) } });
        if (!categoria) return res.status(404).json({ error: "Categoría no encontrada", status: 404 });

        // Verificamos si tiene productos 
        const totalProductos = await prisma.producto.count({ where: { categoriaId: parseInt(id) } });

        if (totalProductos > 0) {
            return res.status(409).json({
                error: `No se puede eliminar la categoría porque tiene ${totalProductos} productos asociados`,
                status: 409,
                total_productos: totalProductos,
                suggestion: "Mueve los productos a otra categoría antes de eliminar"
            });
        }

        await prisma.categoriaProducto.delete({ where: { id: parseInt(id) } });

        res.status(200).json({ message: "Categoría eliminada exitosamente" });

    } catch (error) {
        console.error("Error al eliminar categoría:", error);
        res.status(500).json({ error: "Error interno del servidor", status: 500 });
    }
};

// ESTADÍSTICAS DE CATEGORÍA (GET STATS)
export const obtenerEstadisticasCategoria = async (req, res) => {
    try {
        const { id } = req.params;

        const categoria = await prisma.categoriaProducto.findUnique({ where: { id: parseInt(id) } });
        if (!categoria) return res.status(404).json({ error: "Categoría no encontrada", status: 404 });

        // Traemos los productos incluyendo su stock desde la tabla InventarioStock
        const productos = await prisma.producto.findMany({
            where: { categoriaId: parseInt(id) },
            select: { 
                status: true, 
                isDeleted: true, 
                precio: true,
                stock: {
                    select: { cantidad: true, stockMinimo: true }
                }
            } 
        });

        let activos = 0, inactivos = 0, bajoStock = 0, valorTotal = 0;

        productos.forEach(p => {
            // Solo procesamos los productos que no han sido borrados
            if (!p.isDeleted) {
                // Contar activos e inactivos
                if (p.status === 'activo') activos++;
                else inactivos++;

                // Verificar stock y valor de inventario
                const cantidadActual = p.stock ? p.stock.cantidad : 0;
                const minimoPermitido = p.stock ? p.stock.stockMinimo : 0;

                if (cantidadActual <= minimoPermitido) bajoStock++; 

                valorTotal += (cantidadActual * parseFloat(p.precio || 0));
            }
        });

        res.status(200).json({
            message: "Estadísticas obtenidas",
            data: {
                categoria_id: categoria.id,
                categoria_nombre: categoria.nombre,
                total_productos: activos + inactivos, // Excluimos los borrados (isDeleted)
                productos_activos: activos,
                productos_inactivos: inactivos,
                productos_bajo_stock: bajoStock,
                valor_total_inventario: valorTotal,
                producto_mas_vendido: null // Este requiere cruzar con VentaDetalle, se implementará luego
            }
        });

    } catch (error) {
        console.error("Error al obtener estadísticas:", error);
        res.status(500).json({ error: "Error interno del servidor", status: 500 });
    }
};