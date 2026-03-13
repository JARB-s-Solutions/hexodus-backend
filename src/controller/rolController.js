import prisma from "../config/prisma.js";

// 1. LISTAR ROLES
export const listarRoles = async (req, res) => {
    try {
        // Obtenemos los roles y contamos cuántos usuarios tiene cada uno
        const roles = await prisma.rol.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { usuarios: { where: { status: { not: 'bloqueado' } } } }
                }
            }
        });

        const dataFormateada = roles.map(rol => ({
            id: rol.id,
            nombre: rol.nombre,
            descripcion: rol.descripcion,
            color: rol.color,
            esSistema: rol.esSistema,
            usuariosActivos: rol._count.usuarios,
            // Parseamos el JSON para que el front lo lea como objeto
            permisos: typeof rol.permisos === 'string' ? JSON.parse(rol.permisos) : rol.permisos,
            fechaCreacion: rol.createdAt
        }));

        res.status(200).json({
            success: true,
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al listar roles:", error);
        res.status(500).json({ success: false, error: { message: "Error al obtener los roles" } });
    }
};

// 2. CREAR ROL 
export const crearRol = async (req, res) => {
    try {
        const { id, nombre, descripcion, color, permisos } = req.body;

        if (!id || !nombre) {
            return res.status(400).json({ success: false, error: { message: "El ID y el nombre son obligatorios" } });
        }

        const idNormalizado = id.toLowerCase().trim().replace(/\s+/g, '_');

        // Verificar que el ID del rol no exista (ej. 'recepcionista')
        const rolExistente = await prisma.rol.findUnique({ where: { id: idNormalizado } });
        if (rolExistente) {
            return res.status(400).json({ success: false, error: { message: "Ya existe un rol con este ID" } });
        }

        const nuevoRol = await prisma.rol.create({
            data: {
                id: idNormalizado, // Normalizamos el ID (ej. "Caja Principal" -> "caja_principal")
                nombre,
                descripcion,
                color,
                permisos: permisos || {},
                esSistema: false, // Los roles creados por usuarios nunca son de sistema
                creadoPor: req.user.id
            }
        });

        res.status(201).json({
            success: true,
            data: { ...nuevoRol, permisos: typeof nuevoRol.permisos === 'string' ? JSON.parse(nuevoRol.permisos) : nuevoRol.permisos },
            message: "Rol creado exitosamente"
        });

    } catch (error) {
        console.error("Error al crear rol:", error);
        res.status(500).json({ success: false, error: { message: "Error al crear el rol" } });
    }
};

// 3. ACTUALIZAR ROL 
export const actualizarRol = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, color, permisos } = req.body;

        const rolActual = await prisma.rol.findUnique({ where: { id } });

        if (!rolActual) {
            return res.status(404).json({ success: false, error: { message: "Rol no encontrado" } });
        }

        // Preparamos los datos a actualizar
        const dataUpdate = {};
        if (nombre) dataUpdate.nombre = nombre;
        if (descripcion !== undefined) dataUpdate.descripcion = descripcion;
        if (color !== undefined) dataUpdate.color = color;
        if (permisos) dataUpdate.permisos = permisos;

        const rolActualizado = await prisma.rol.update({
            where: { id },
            data: dataUpdate
        });

        res.status(200).json({
            success: true,
            data: { ...rolActualizado, permisos: typeof rolActualizado.permisos === 'string' ? JSON.parse(rolActualizado.permisos) : rolActualizado.permisos },
            message: "Rol actualizado exitosamente"
        });

    } catch (error) {
        console.error("Error al actualizar rol:", error);
        res.status(500).json({ success: false, error: { message: "Error al actualizar el rol" } });
    }
};

// 4. ELIMINAR ROL 
export const eliminarRol = async (req, res) => {
    try {
        const { id } = req.params;

        const rol = await prisma.rol.findUnique({ 
            where: { id },
            include: { _count: { select: { usuarios: { where: { status: { not: 'bloqueado' } } } } } }
        });

        if (!rol) {
            return res.status(404).json({ success: false, error: { message: "Rol no encontrado" } });
        }

        // REGLA 1: No se pueden borrar roles del sistema
        if (rol.esSistema) {
            return res.status(403).json({ success: false, error: { message: "No puedes eliminar un rol del sistema" } });
        }

        // REGLA 2: No se pueden borrar roles si hay usuarios activos/inactivos usándolo
        if (rol._count.usuarios > 0) {
            return res.status(400).json({ 
                success: false, 
                error: { message: `No puedes eliminar este rol porque hay ${rol._count.usuarios} usuario(s) usándolo. Reasígnalos primero.` } 
            });
        }

        // REGLA 3: Reasignar usuarios bloqueados que aún tengan este rol
        // (rolId es NOT NULL en el schema, por lo que el DELETE fallaría con FK constraint
        //  si hay usuarios bloqueados asignados a este rol)
        const rolFallback = await prisma.rol.findFirst({
            where: { esSistema: true, id: { not: id } },
            orderBy: { createdAt: 'asc' }
        });

        if (!rolFallback) {
            return res.status(500).json({ 
                success: false, 
                error: { message: "No se encontró un rol de sistema de respaldo para reasignar usuarios bloqueados." } 
            });
        }

        await prisma.$transaction([
            prisma.usuario.updateMany({
                where: { rolId: id, status: 'bloqueado' },
                data: { rolId: rolFallback.id }
            }),
            prisma.rol.delete({ where: { id } })
        ]);

        res.status(200).json({
            success: true,
            message: "Rol eliminado exitosamente"
        });

    } catch (error) {
        console.error("Error al eliminar rol:", error);
        res.status(500).json({ success: false, error: { message: "Error al eliminar el rol" } });
    }
};