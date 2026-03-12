import prisma from "../config/prisma.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { registrarLog } from "../services/auditoriaService.js";

// LISTAR USUARIOS
export const listarUsuarios = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const { search, rol, activo } = req.query;

        // Construir filtros
        let whereClause = {};
        
        if (search) {
            whereClause.OR = [
                { nombreCompleto: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (rol) whereClause.rolId = rol;
        
        if (activo !== undefined) {
            // Si el front pide explícitamente activos o inactivos
            whereClause.status = activo === 'true' ? 'activo' : 'inactivo';
        } else {
            // Si no hay filtro, trae activos e inactivos, pero NUNCA los eliminados
            whereClause.status = { not: 'bloqueado' };
        }

        // Ejecutar consultas en paralelo
        const [totalRecords, usuariosRaw] = await Promise.all([
            prisma.usuario.count({ where: whereClause }),
            prisma.usuario.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    rol: {
                        select: { id: true, nombre: true, color: true, icono: true }
                    }
                }
            })
        ]);

        // Mapear a la estructura exacta que pide el Frontend (Markdown)
        const dataFormateada = usuariosRaw.map(u => ({
            id: u.uid, // Exponemos el UID por seguridad en lugar del ID entero
            nombre: u.nombreCompleto,
            email: u.email,
            telefono: u.telefono,
            username: u.username,
            rol: u.rol,
            activo: u.status === 'activo',
            ultimoAcceso: u.ultimoAcceso,
            fechaCreacion: u.createdAt
        }));

        res.status(200).json({
            success: true,
            data: {
                usuarios: dataFormateada,
                paginacion: {
                    total: totalRecords,
                    pagina: page,
                    limite: limit,
                    totalPaginas: Math.ceil(totalRecords / limit)
                }
            }
        });

    } catch (error) {
        console.error("Error al listar usuarios:", error);
        res.status(500).json({ success: false, error: { message: "Error interno al obtener los usuarios" } });
    }
};

// CREAR USUARIO 
export const crearUsuario = async (req, res) => {
    try {
        const { nombre, email, username, telefono, password, rolId } = req.body;

        if (!nombre || !email || !username || !password || !rolId) {
            return res.status(400).json({ 
                success: false, 
                error: { message: "Faltan datos obligatorios (nombre, email, username, password, rolId)" } 
            });
        }

        // Verificar si email o username ya existen
        const usuarioExistente = await prisma.usuario.findFirst({
            where: { OR: [{ email }, { username }] }
        });

        if (usuarioExistente) {
            return res.status(400).json({
                success: false,
                error: { code: "USER_EXISTS", message: "Ya existe un usuario con este email o nombre de usuario" }
            });
        }

        // Verificar que el Rol exista
        const rolAsignar = await prisma.rol.findUnique({ where: { id: rolId } });
        if (!rolAsignar) {
            return res.status(404).json({ success: false, error: { message: "El rol especificado no existe" } });
        }

        // Encriptar contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Crear el usuario en la BD
        const nuevoUsuario = await prisma.usuario.create({
            data: {
                uid: crypto.randomUUID(),
                nombreCompleto: nombre,
                email: email,
                username: username,
                telefono: telefono || null,
                password: hashedPassword,
                rolId: rolAsignar.id,
                status: 'activo' // Por defecto al crear
            },
            include: {
                rol: true // Para devolverlo en la respuesta
            }
        });

        // Respuesta 
        res.status(201).json({
            success: true,
            data: {
                id: nuevoUsuario.uid,
                nombre: nuevoUsuario.nombreCompleto,
                email: nuevoUsuario.email,
                username: nuevoUsuario.username,
                telefono: nuevoUsuario.telefono,
                rol: {
                    id: nuevoUsuario.rol.id,
                    nombre: nuevoUsuario.rol.nombre,
                    color: nuevoUsuario.rol.color,
                    icono: nuevoUsuario.rol.icono,
                    permisos: typeof nuevoUsuario.rol.permisos === 'string' ? JSON.parse(nuevoUsuario.rol.permisos) : nuevoUsuario.rol.permisos
                },
                activo: true,
                fechaCreacion: nuevoUsuario.createdAt
            },
            message: `Usuario creado exitosamente con rol '${nuevoUsuario.rol.nombre}'`
        });

    } catch (error) {
        console.error("Error al crear usuario:", error);
        res.status(500).json({ success: false, error: { message: "Error interno al crear el usuario" } });
    }
};


// 3. OBTENER DETALLE DE USUARIO 
export const obtenerUsuario = async (req, res) => {
    try {
        const { id } = req.params; // El Frontend nos enviará el UID seguro

        const usuario = await prisma.usuario.findUnique({
            where: { uid: id },
            include: { rol: true }
        });

        if (!usuario) {
            return res.status(404).json({ success: false, error: { message: "Usuario no encontrado" } });
        }

        res.status(200).json({
            success: true,
            data: {
                id: usuario.uid,
                nombre: usuario.nombreCompleto,
                email: usuario.email,
                username: usuario.username,
                telefono: usuario.telefono,
                rol: {
                    id: usuario.rol.id,
                    nombre: usuario.rol.nombre,
                    permisos: typeof usuario.rol.permisos === 'string' ? JSON.parse(usuario.rol.permisos) : usuario.rol.permisos
                },
                activo: usuario.status === 'activo',
                fechaCreacion: usuario.createdAt
            }
        });

    } catch (error) {
        console.error("Error al obtener usuario:", error);
        res.status(500).json({ success: false, error: { message: "Error interno al obtener el usuario" } });
    }
};

// 4. ACTUALIZAR USUARIO 
export const actualizarUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, email, username, telefono, password, rolId, activo } = req.body;

        const usuarioActual = await prisma.usuario.findUnique({ where: { uid: id } });
        
        if (!usuarioActual) {
            return res.status(404).json({ success: false, error: { message: "Usuario no encontrado" } });
        }

        // 1. Validar que el nuevo correo/username no estén tomados por otro usuario
        if (email || username) {
            const duplicado = await prisma.usuario.findFirst({
                where: {
                    OR: [
                        email ? { email } : {},
                        username ? { username } : {}
                    ],
                    NOT: { uid: id } // Excluimos al usuario que estamos editando
                }
            });

            if (duplicado) {
                return res.status(400).json({ 
                    success: false, 
                    error: { message: "El correo o nombre de usuario ya está en uso por otra persona" } 
                });
            }
        }

        // 2. Preparamos los datos a actualizar
        const dataUpdate = {};
        if (nombre) dataUpdate.nombreCompleto = nombre;
        if (email) dataUpdate.email = email;
        if (username) dataUpdate.username = username;
        if (telefono !== undefined) dataUpdate.telefono = telefono;
        if (rolId) dataUpdate.rolId = rolId;
        if (activo !== undefined) dataUpdate.status = activo ? 'activo' : 'inactivo';

        // 3. Si mandó contraseña nueva, la hasheamos
        if (password) {
            const salt = await bcrypt.genSalt(10);
            dataUpdate.password = await bcrypt.hash(password, salt);
        }

        // 4. Ejecutamos la actualización
        const usuarioActualizado = await prisma.usuario.update({
            where: { uid: id },
            data: dataUpdate,
            include: { rol: true }
        });

        await registrarLog({
            req,
            accion: 'editar',
            modulo: 'usuarios',
            registroId: id,
            detalles: `Se editaron los datos del usuario "${usuarioActualizado.nombreCompleto}" (@${usuarioActualizado.username}) — Rol asignado: ${usuarioActualizado.rol.nombre}`
        });

        res.status(200).json({
            success: true,
            data: {
                id: usuarioActualizado.uid,
                nombre: usuarioActualizado.nombreCompleto,
                email: usuarioActualizado.email,
                username: usuarioActualizado.username,
                rol: usuarioActualizado.rol.nombre,
                activo: usuarioActualizado.status === 'activo'
            },
            message: "Usuario actualizado exitosamente"
        });

    } catch (error) {
        console.error("Error al actualizar usuario:", error);
        res.status(500).json({ success: false, error: { message: "Error interno al actualizar el usuario" } });
    }
};

// 5. DESACTIVAR USUARIO (Soft Delete + Liberación de Credenciales) 
export const eliminarUsuario = async (req, res) => {
    try {
        const { id } = req.params;

        const usuario = await prisma.usuario.findUnique({ where: { uid: id } });
        if (!usuario) {
            return res.status(404).json({ success: false, error: { message: "Usuario no encontrado" } });
        }

        // Regla de seguridad: Un usuario no puede eliminarse a sí mismo
        if (req.user.id === usuario.id) {
            return res.status(403).json({ success: false, error: { message: "No puedes desactivar tu propia cuenta activa" } });
        }

        // Creamos un sufijo único basado en la fecha actual (ej. _del_1710255871000)
        const timestampSufijo = `_del_${Date.now()}`;
        
        // Recortamos el original por si es muy largo para no romper el límite del VarChar en BD
        const emailLiberado = `${usuario.email.substring(0, 130)}${timestampSufijo}`;
        const usernameLiberado = `${usuario.username.substring(0, 30)}${timestampSufijo}`;

        // Hacemos "Soft Delete" y liberamos las credenciales
        await prisma.usuario.update({
            where: { uid: id },
            data: { 
                status: 'bloqueado',
                email: emailLiberado,
                username: usernameLiberado
            }
        });

        await registrarLog({
            req,
            accion: 'eliminar',
            modulo: 'usuarios',
            registroId: id,
            detalles: `El usuario "${usuario.nombreCompleto}" (@${usuario.username}) fue desactivado del sistema y sus credenciales liberadas.`
        });

        res.status(200).json({
            success: true,
            message: "Usuario eliminado exitosamente y sus credenciales han sido liberadas."
        });

    } catch (error) {
        console.error("Error al eliminar usuario:", error);
        res.status(500).json({ success: false, error: { message: "Error interno al desactivar el usuario" } });
    }
};