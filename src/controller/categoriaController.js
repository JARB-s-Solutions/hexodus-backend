import prisma from "../config/prisma.js";

// CREAR CATEGORÍA
export const crearCategoria = async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre) return res.status(400).json({ error: "El nombre de la categoría es obligatorio." });

        const existe = await prisma.categoriaProducto.findUnique({ where: { nombre: nombre.trim() } });
        if (existe) return res.status(400).json({ error: "Esta categoría ya existe." });

        const nuevaCategoria = await prisma.categoriaProducto.create({
            data: { nombre: nombre.trim() }
        });

        res.status(201).json({ message: "Categoría creada.", data: nuevaCategoria });
    } catch (error) {
        res.status(500).json({ error: "Error al crear categoría." });
    }
};

// LISTAR CATEGORÍAS
export const listarCategorias = async (req, res) => {
    try {
        const categorias = await prisma.categoriaProducto.findMany({ orderBy: { nombre: 'asc' } });
        res.status(200).json({ data: categorias });
    } catch (error) {
        res.status(500).json({ error: "Error al listar categorías." });
    }
};