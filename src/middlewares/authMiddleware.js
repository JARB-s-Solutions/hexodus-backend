import jwt from 'jsonwebtoken';

export const verificarToken = (req, res, next) => {
    try {
        // Obtener el token de los headers
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: "Acceso denegado. Token faltante o formato incorrecto." });
        }

        const token = authHeader.split(' ')[1];

        // Verificar el token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Inyectar los datos del usuario en la request (req.user)
        req.user = decoded;

        // Continuar con el siguiente controlador
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: "El token ha expirado. Por favor, inicia sesión de nuevo." });
        }
        return res.status(401).json({ error: "Token inválido." });
    }
};