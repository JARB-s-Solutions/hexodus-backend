import prisma from "../config/prisma.js";
import { aHoraCampeche } from "../utils/dateHelper.js"; // Importamos el ayudante

// CREAR MÉTODO DE PAGO
export const crearMetodoPago = async (req, res) => {
    try {
        const { nombre } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: "El nombre del método de pago es obligatorio." });
        }

        const existe = await prisma.metodoPago.findUnique({
            where: { nombre: nombre }
        });

        if (existe) {
            return res.status(400).json({ error: "Este método de pago ya está registrado." });
        }

        const nuevoMetodo = await prisma.metodoPago.create({
            data: { 
                nombre: nombre,
                createdBy: req.user?.id || null 
            }
        });

        res.status(201).json({
            message: "Método de pago creado exitosamente.",
            data: {
                id: nuevoMetodo.id,
                nombre: nuevoMetodo.nombre,
                status: nuevoMetodo.status,
                is_deleted: nuevoMetodo.isDeleted,
                deleted_at: aHoraCampeche(nuevoMetodo.deletedAt), // Formateamos a Campeche
                create_by: nuevoMetodo.createdBy,
                create_at: aHoraCampeche(nuevoMetodo.createdAt)   // Formateamos a Campeche
            }
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
            where: { isDeleted: false },
            orderBy: { id: 'asc' } 
        });

        const dataFormateada = metodos.map(m => ({
            id: m.id,
            nombre: m.nombre,
            status: m.status,
            is_deleted: m.isDeleted,
            deleted_at: aHoraCampeche(m.deletedAt), // Formateamos a Campeche
            create_by: m.createdBy,
            create_at: aHoraCampeche(m.createdAt)   // Formateamos a Campeche
        }));

        res.status(200).json({
            message: "Métodos de pago obtenidos.",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al listar métodos de pago:", error);
        res.status(500).json({ error: "Error interno al listar los datos." });
    }
};