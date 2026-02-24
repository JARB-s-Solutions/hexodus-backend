import prisma from "../config/prisma.js";

// CREAR MÉTODO DE PAGO
export const crearMetodoPago = async (req, res) => {
    try {
        const { nombre } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: "El nombre del método de pago es obligatorio." });
        }

        // Verificar que no exista uno con el mismo nombre (tu esquema dice @unique)
        const existe = await prisma.metodoPago.findUnique({
            where: { nombre: nombre }
        });

        if (existe) {
            return res.status(400).json({ error: "Este método de pago ya está registrado." });
        }

        // Crear en la BD
        const nuevoMetodo = await prisma.metodoPago.create({
            data: { nombre: nombre }
        });

        res.status(201).json({
            message: "Método de pago creado exitosamente.",
            data: nuevoMetodo
        });

    } catch (error) {
        console.error("Error al crear método de pago:", error);
        res.status(500).json({ error: "Error interno al crear el método de pago." });
    }
};

// LISTAR MÉTODOS DE PAGO
export const listarMetodosPago = async (req, res) => {
    try {
        const metodos = await prisma.metodoPago.findMany({
            orderBy: { id: 'asc' } // Traerlos ordenados por ID (1, 2, 3...)
        });

        res.status(200).json({
            message: "Métodos de pago obtenidos.",
            data: metodos
        });

    } catch (error) {
        console.error("Error al listar métodos de pago:", error);
        res.status(500).json({ error: "Error interno al listar los datos." });
    }
};