import prisma from "../config/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../utils/email.js";

// LOGIN 
export const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validar que lleguen datos
        if (!username || !password) {
            return res.status(400).json({ error: "Por favor ingrese usuario y contraseña" });
        }

        // Buscar usuario
        const usuario = await prisma.usuario.findUnique({
            where: { username },
            include: { rol: true } 
        });

        // Validar existencia y contraseña
        if (!usuario || !(await bcrypt.compare(password, usuario.password))) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }

        // Validar estado
        if (usuario.status !== 'activo') {
            return res.status(403).json({ error: "Usuario inactivo. Contacte al administrador." });
        }

        // Generar Token JWT
        const token = jwt.sign(
            { 
                id: usuario.id, 
                role: usuario.rol?.nombre || 'usuario' 
            },
            process.env.JWT_SECRET, 
            { expiresIn: '1d' }
        );

        // 6. RESPUESTA CON TU ESTRUCTURA PERSONALIZADA
        res.status(200).json({
            message: "Bienvenido de nuevo",
            token: token,
            user: {
                usuario_id: usuario.id,          
                uid: usuario.uid,                
                username: usuario.username,      
                nombre_completo: usuario.nombreCompleto 
            }
        });

    } catch (error) {
        console.error("Error en Login:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// FORGOT PASSWORD
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: "El email es obligatorio" });
        }

        const usuario = await prisma.usuario.findUnique({ where: { email } });
        
        if (!usuario) {
            // SEGURIDAD: Respondemos lo mismo aunque no exista para no revelar usuarios.
            return res.status(200).json({ message: "Si el correo existe, recibirás un enlace de recuperación." });
        }

        // Generar token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        // Guardar en BD (10 min validez)
        await prisma.usuario.update({
            where: { email },
            data: {
                passwordResetToken: hashedToken,
                passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000)
            }
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        
        // Asumiendo que tu archivo HTML está en esa ruta
        const resetUrl = `${frontendUrl}/views/recuperar-password.html?token=${resetToken}`;

        const message = `Has solicitado restablecer tu contraseña.`;

        try {
            await sendEmail({
                email: usuario.email,
                subject: 'Recuperación de contraseña - Exodus Gym',
                message, // Texto plano
                link: resetUrl // Para el botón HTML
            });

            res.status(200).json({ message: "Si el correo existe, recibirás un enlace de recuperación." });
            
        } catch (err) {
            console.error("Error enviando email:", err);
            // Revertir cambios si falla el correo
            await prisma.usuario.update({
                where: { email },
                data: { passwordResetToken: null, passwordResetExpires: null }
            });
            return res.status(500).json({ error: "Hubo un error enviando el correo. Intente más tarde." });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en el servidor" });
    }
};

// RESET PASSWORD
export const resetPassword = async (req, res) => {
    try {
        const { token } = req.params; 
        const { password } = req.body;

        // Validar inputs
        if (!token) {
            return res.status(400).json({ error: "Token inválido" });
        }
        
        // Validación de fuerza de contraseña
        if (!password || password.length < 6) {
            return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
        }

        // Hashear token recibido para buscar en BD
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // Buscar usuario con token válido y NO expirado
        const usuario = await prisma.usuario.findFirst({
            where: {
                passwordResetToken: hashedToken,
                passwordResetExpires: { gt: new Date() } 
            }
        });

        if (!usuario) {
            return res.status(400).json({ error: "El enlace es inválido o ha expirado" });
        }

        // Encriptar nueva contraseña
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(password, salt);

        // Actualizar usuario
        await prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                password: newPasswordHash,
                passwordResetToken: null, 
                passwordResetExpires: null
            }
        });

        res.status(200).json({ message: "Contraseña actualizada exitosamente" });

    } catch (error) {
        console.error("Error resetPassword:", error);
        res.status(500).json({ error: "Error al actualizar la contraseña" });
    }
};