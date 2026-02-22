import prisma from "../config/prisma.js";
import crypto from "crypto";

export const crearMembresia = async (req, res) => {
    try {
        const {
            nombre,
            precioBase,
            duracionCantidad, // ej: 1, 3, 6
            duracionUnidad,   // ej: 'Dias', 'Meses', 'Anios'
            esOferta,         // Boolean del checkbox
            precioOferta,     // Precio rebajado (Opcional)
            fechaFinOferta,   // Fecha límite (Opcional)
            descripcion
        } = req.body;

        // Validaciones básicas obligatorias
        if (!nombre || precioBase === undefined || !duracionCantidad || !duracionUnidad) {
            return res.status(400).json({ error: "Los campos Nombre, Precio y Configuración de Duración son obligatorios." });
        }

        // Lógica para Oferta Especial
        if (esOferta) {
            if (precioOferta === undefined || !fechaFinOferta) {
                return res.status(400).json({ error: "Si es una oferta especial, debes indicar el Precio Original (Oferta) y la Fecha de Vencimiento." });
            }
            if (new Date(fechaFinOferta) < new Date()) {
                return res.status(400).json({ error: "La fecha de fin de oferta no puede estar en el pasado." });
            }
        }

        // Conversión de Duración a Días 
        let duracionDias = 0;
        const cantidad = parseInt(duracionCantidad);

        switch (duracionUnidad.toLowerCase()) {
            case 'dias':
            case 'día':
            case 'días':
                duracionDias = cantidad;
                break;
            case 'semanas':
            case 'semana':
                duracionDias = cantidad * 7;
                break;
            case 'meses':
            case 'mes':
                duracionDias = cantidad * 30; // Estandarizado a 30 días
                break;
            case 'años':
            case 'año':
            case 'anios':
                duracionDias = cantidad * 365;
                break;
            default:
                return res.status(400).json({ error: "Unidad de duración no válida. Usa: dias, semanas, meses, o años." });
        }

        // Inserción en la Base de Datos
        const nuevaMembresia = await prisma.membresiaPlan.create({
            data: {
                uuidPlan: crypto.randomUUID(),
                nombre: nombre,
                duracionDias: duracionDias, // El valor ya convertido
                precioBase: precioBase,
                esOferta: esOferta || false,
                // Si es oferta guarda los datos, si no, los deja en null
                precioOferta: esOferta ? precioOferta : null,
                fechaFinOferta: esOferta ? new Date(fechaFinOferta) : null,
                descripcion: descripcion || null,
                status: 'activo',
                createdBy: req.user.id // Viene del token gracias al middleware
            }
        });

        res.status(201).json({
            message: "Membresía creada exitosamente",
            data: nuevaMembresia
        });

    } catch (error) {
        console.error("Error al crear membresía:", error);
        res.status(500).json({ error: "Error interno del servidor al guardar la membresía." });
    }
};