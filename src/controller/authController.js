import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import prisma from "../config/prisma.js";
import supabase from "../config/supabase.js";

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validaciones básicas
        if (!username || !password) {
            return res.status(400).json({ 
                error: "El username y la contraseña son obligatorios." 
            });
        }

        // Buscar al usuario en TU base de datos (Prisma) para obtener su Email
        // Supabase Auth exige email para loguear, pero tu front manda username.
        const usuarioLocal = await prisma.usuario.findUnique({
            where: { username: username },
            select: {
                id: true,
                uid: true,
                username: true,
                nombreCompleto: true,
                email: true,
                status: true
            }
        });

        // Si no existe el usuario o está inactivo
        if (!usuarioLocal) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }

        if (usuarioLocal.status !== 'activo') {
            return res.status(403).json({ error: "El usuario está inactivo. Contacte al administrador." });
        }

        // Autenticar contra Supabase Auth usando el EMAIL recuperado
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: usuarioLocal.email,
            password: password, // La contraseña que envió el usuario
        });

        if (authError) {
            return res.status(401).json({ error: "Credenciales inválidas (Password incorrecta)" });
        }

        // Preparar la respuesta con el formato
        res.status(200).json({
            message: "Bienvenido de nuevo",
            token: authData.session.access_token, // El JWT generado por Supabase
            user: {
                usuario_id: usuarioLocal.id,
                uid: usuarioLocal.uid,
                username: usuarioLocal.username,
                nombre_completo: usuarioLocal.nombreCompleto
            }
        });

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};
