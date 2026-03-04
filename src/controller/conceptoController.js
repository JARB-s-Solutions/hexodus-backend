import prisma from "../config/prisma.js";

// OBTENER CATÁLOGO DE CONCEPTOS
export const listarConceptos = async (req, res) => {
    try {
        const { tipo } = req.query; // Puede ser 'ingreso' o 'gasto'

        let whereClause = {};
        
        // Si el frontend manda un tipo específico, filtramos
        if (tipo && ['ingreso', 'gasto'].includes(tipo)) {
            whereClause.tipo = tipo;
        }

        // Buscamos los conceptos ordenados alfabéticamente
        const conceptos = await prisma.concepto.findMany({
            where: whereClause,
            orderBy: { nombre: 'asc' },
            select: {
                id: true,
                nombre: true,
                tipo: true
            }
        });

        res.status(200).json({
            message: "Catálogo de conceptos obtenido correctamente.",
            data: conceptos
        });

    } catch (error) {
        console.error("Error al obtener conceptos:", error);
        res.status(500).json({ error: "Error interno al obtener el catálogo de conceptos." });
    }
};

// CREAR NUEVO CONCEPTO
export const crearConcepto = async (req, res) => {
    try {
        let { nombre, tipo } = req.body;

        if (!nombre || !tipo) {
            return res.status(400).json({ error: "El nombre y el tipo ('ingreso' o 'gasto') son obligatorios." });
        }

        // Convertimos a minúsculas y quitamos espacios en blanco
        let tipoFormateado = tipo.toLowerCase().trim();

        // Si el frontend manda "egreso" o "egresos", lo traducimos al "gasto" de Prisma
        if (tipoFormateado.includes('egreso')) {
            tipoFormateado = 'gasto';
        }
        // Si manda "ingresos" en plural, lo pasamos a singular
        if (tipoFormateado.includes('ingreso')) {
            tipoFormateado = 'ingreso';
        }

        // Validación final de seguridad
        if (!['ingreso', 'gasto'].includes(tipoFormateado)) {
            return res.status(400).json({ error: "El tipo de concepto no es válido. Debe ser ingreso o gasto." });
        }

        const nuevoConcepto = await prisma.concepto.create({
            data: {
                nombre: nombre,
                tipo: tipoFormateado // Usamos la variable ya limpia
            }
        });

        res.status(201).json({
            message: "Concepto creado exitosamente.",
            data: nuevoConcepto
        });

    } catch (error) {
        console.error("Error al crear concepto:", error);
        res.status(500).json({ error: "Error interno al crear el concepto." });
    }
};