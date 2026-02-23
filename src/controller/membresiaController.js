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


// LISTAR MEMBRESÍAS (Con filtros, paginación y conteo de socios)
export const listarMembresias = async (req, res) => {
    try {
        // Obtener parámetros de la query (URL)
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        const { search, estado, tipo_dias, min_precio, max_precio } = req.query;

        // Construir el objeto de filtros dinámicos (WHERE)
        let whereClause = {};

        // Filtro: Búsqueda por texto (nombre o descripción)
        if (search) {
            whereClause.OR = [
                { nombre: { contains: search, mode: 'insensitive' } },
                { descripcion: { contains: search, mode: 'insensitive' } }
            ];
        }

        // Filtro: Estado (activo / inactivo)
        if (estado && estado !== 'Todos los Estados') {
            whereClause.status = estado;
        }

        // Filtro: Tipo de Membresía (por duración en días)
        if (tipo_dias) {
            whereClause.duracionDias = parseInt(tipo_dias);
        }

        // Filtro: Rango de Precio Base
        if (min_precio || max_precio) {
            whereClause.precioBase = {};
            if (min_precio) whereClause.precioBase.gte = parseFloat(min_precio);
            if (max_precio) whereClause.precioBase.lte = parseFloat(max_precio);
        }

        // Ejecutar consulta a la BD
        const [totalRecords, membresiasRaw] = await Promise.all([
            prisma.membresiaPlan.count({ where: whereClause }),
            prisma.membresiaPlan.findMany({
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { createdAt: 'desc' }, // Las más nuevas primero
                include: {
                    // Contamos cuántos socios tienen este plan "activo"
                    _count: {
                        select: {
                            membresiasSocio: {
                                where: { status: 'activa' }
                            }
                        }
                    }
                }
            })
        ]);

        // Formatear la respuesta para hacerle la vida fácil al Frontend
        const dataFormateada = membresiasRaw.map(plan => {
            // Generar la etiqueta del badge superior (DIARIO, SEMANAL, MENSUAL, ANUAL)
            let etiquetaTipo = 'PERSONALIZADO';
            if (plan.duracionDias === 1) etiquetaTipo = 'DIARIO';
            else if (plan.duracionDias === 7) etiquetaTipo = 'SEMANAL';
            else if (plan.duracionDias === 30) etiquetaTipo = 'MENSUAL';
            else if (plan.duracionDias === 365) etiquetaTipo = 'ANUAL';

            // Evaluar si la oferta sigue vigente
            const hoy = new Date();
            const esOfertaValida = plan.esOferta && plan.fechaFinOferta && (new Date(plan.fechaFinOferta) >= hoy);

            return {
                plan_id: plan.id,
                uuid_plan: plan.uuidPlan,
                etiqueta_tipo: etiquetaTipo,
                nombre: plan.nombre,
                descripcion: plan.descripcion,
                duracion_dias: plan.duracionDias,
                status: plan.status,
                
                // Precios
                precio_base: parseFloat(plan.precioBase),
                es_oferta_valida: esOfertaValida,
                precio_oferta: esOfertaValida ? parseFloat(plan.precioOferta) : null,
                fecha_fin_oferta: esOfertaValida ? plan.fechaFinOferta : null,
                
                // Precio final a cobrar (calculado para el POS)
                precio_final: esOfertaValida ? parseFloat(plan.precioOferta) : parseFloat(plan.precioBase),

                // Dato calculado: Socios activos
                socios_activos: plan._count.membresiasSocio
            };
        });

        // Respuesta
        res.status(200).json({
            message: "Membresías obtenidas correctamente",
            data: dataFormateada,
            pagination: {
                current_page: page,
                limit: limit,
                total_records: totalRecords,
                total_pages: Math.ceil(totalRecords / limit)
            }
        });

    } catch (error) {
        console.error("Error al listar membresías:", error);
        res.status(500).json({ error: "Error interno al obtener los datos." });
    }
};


// OBTENER UNA MEMBRESÍA ESPECÍFICA (Por ID)
export const obtenerMembresia = async (req, res) => {
    try {
        const { id } = req.params;

        // Validar que el ID sea un número
        if (isNaN(id)) {
            return res.status(400).json({ error: "El ID proporcionado no es válido." });
        }

        // Buscar en la Base de Datos
        const membresia = await prisma.membresiaPlan.findUnique({
            where: { id: parseInt(id) }
        });

        // Validar si existe
        if (!membresia) {
            return res.status(404).json({ error: "Membresía no encontrada." });
        }

        // Evaluar si la oferta sigue vigente en tiempo real (Igual que en listar)
        const hoy = new Date();
        const esOfertaValida = membresia.esOferta && membresia.fechaFinOferta && (new Date(membresia.fechaFinOferta) >= hoy);

        // Transformar duracionDias a la vista del Frontend (Opcional, pero ayuda al UI)
        let duracionUnidad = 'días';
        let duracionCantidad = membresia.duracionDias;

        if (membresia.duracionDias === 7) { duracionCantidad = 1; duracionUnidad = 'semanas'; }
        else if (membresia.duracionDias === 30) { duracionCantidad = 1; duracionUnidad = 'meses'; }
        else if (membresia.duracionDias === 365) { duracionCantidad = 1; duracionUnidad = 'años'; }

        // Formatear la respuesta
        const dataFormateada = {
            plan_id: membresia.id,
            uuid_plan: membresia.uuidPlan,
            nombre: membresia.nombre,
            descripcion: membresia.descripcion,
            
            // Datos crudos
            duracion_dias: membresia.duracionDias,
            
            // Datos formateados para que el UI pueda rellenar los selects fácilmente
            duracion_ui: {
                cantidad: duracionCantidad,
                unidad: duracionUnidad
            },
            
            status: membresia.status,
            
            // Precios
            precio_base: parseFloat(membresia.precioBase),
            es_oferta_valida: esOfertaValida,
            precio_oferta: esOfertaValida ? parseFloat(membresia.precioOferta) : null,
            fecha_fin_oferta: esOfertaValida ? membresia.fechaFinOferta : null,
            precio_final: esOfertaValida ? parseFloat(membresia.precioOferta) : parseFloat(membresia.precioBase)
        };

        res.status(200).json({
            message: "Membresía obtenida correctamente",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al obtener membresía:", error);
        res.status(500).json({ error: "Error interno al obtener los datos." });
    }
};


// ACTUALIZAR MEMBRESÍA (PUT)
export const editarMembresia = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre,
            precioBase,
            duracionCantidad, 
            duracionUnidad,   
            esOferta,         
            precioOferta,     
            fechaFinOferta,   
            descripcion
        } = req.body;

        if (isNaN(id)) return res.status(400).json({ error: "ID inválido." });

        // Validaciones básicas
        if (!nombre || precioBase === undefined || !duracionCantidad || !duracionUnidad) {
            return res.status(400).json({ error: "Los campos Nombre, Precio y Configuración de Duración son obligatorios." });
        }

        // Lógica para Oferta Especial
        if (esOferta) {
            if (precioOferta === undefined || !fechaFinOferta) {
                return res.status(400).json({ error: "Faltan datos de la oferta especial." });
            }
        }

        // Conversión de Duración a Días
        let duracionDias = 0;
        const cantidad = parseInt(duracionCantidad);

        switch (duracionUnidad.toLowerCase()) {
            case 'dias': case 'día': case 'días': duracionDias = cantidad; break;
            case 'semanas': case 'semana': duracionDias = cantidad * 7; break;
            case 'meses': case 'mes': duracionDias = cantidad * 30; break;
            case 'años': case 'año': case 'anios': duracionDias = cantidad * 365; break;
            default: return res.status(400).json({ error: "Unidad de duración no válida." });
        }

        // Verificar que exista antes de editar
        const existe = await prisma.membresiaPlan.findUnique({ where: { id: parseInt(id) } });
        if (!existe) return res.status(404).json({ error: "La membresía no existe." });

        // Actualizar en Base de Datos
        const membresiaActualizada = await prisma.membresiaPlan.update({
            where: { id: parseInt(id) },
            data: {
                nombre: nombre,
                duracionDias: duracionDias,
                precioBase: precioBase,
                esOferta: esOferta || false,
                precioOferta: esOferta ? precioOferta : null,
                fechaFinOferta: esOferta ? new Date(fechaFinOferta) : null,
                descripcion: descripcion || null,
            }
        });

        res.status(200).json({
            message: "Membresía actualizada correctamente",
            data: membresiaActualizada
        });

    } catch (error) {
        console.error("Error al editar membresía:", error);
        res.status(500).json({ error: "Error interno al actualizar la membresía." });
    }
};

// CAMBIAR ESTADO - ACTIVAR / DESACTIVAR
export const cambiarStatusMembresia = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (isNaN(id)) return res.status(400).json({ error: "ID inválido." });

        // Validar que el status sea exactamente el del Enum de Prisma
        if (status !== 'activo' && status !== 'inactivo') {
            return res.status(400).json({ error: "El status solo puede ser 'activo' o 'inactivo'." });
        }

        // Actualizar solo ese campo
        const membresiaActualizada = await prisma.membresiaPlan.update({
            where: { id: parseInt(id) },
            data: { status: status }
        });

        res.status(200).json({
            message: `Membresía marcada como ${status} exitosamente.`,
            data: {
                plan_id: membresiaActualizada.id,
                status: membresiaActualizada.status
            }
        });

    } catch (error) {
        // P2025 es el código de error de Prisma cuando no encuentra el registro a actualizar
        if (error.code === 'P2025') {
            return res.status(404).json({ error: "Membresía no encontrada." });
        }
        console.error("Error al cambiar status:", error);
        res.status(500).json({ error: "Error interno al cambiar el estado." });
    }
};