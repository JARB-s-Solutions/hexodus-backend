import jwt from 'jsonwebtoken';

// 1. VERIFICAR TOKEN 
export const verificarToken = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: "Acceso denegado. Token faltante o formato incorrecto." });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        req.user = decoded; // Aquí ya viene el JSON con los permisos inyectados
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: "El token ha expirado. Por favor, inicia sesión de nuevo." });
        }
        return res.status(401).json({ error: "Token inválido." });
    }
};

// 2. VERIFICAR PERMISOS 
export const verificarPermiso = (modulo, accion = 'ver') => {
    return (req, res, next) => {
        const user = req.user;

        // 1. Si no hay rol, bloqueamos
        if (!user || !user.rol) {
            return res.status(403).json({ error: "Acceso denegado. Rol no identificado." });
        }

        // 2. El Administrador del sistema tiene pase libre a todo
        if (user.rol.esAdministrador) {
            return next();
        }

        // 3. Buscar exactamente en el JSON de permisos (Ej: permisos["socios"]["crear"])
        const tienePermiso = user.permisos && 
                             user.permisos[modulo] && 
                             user.permisos[modulo][accion] === true;

        if (!tienePermiso) {
            return res.status(403).json({ 
                error: `Acceso denegado. No tienes permisos para realizar la acción '${accion}' en el módulo '${modulo}'.` 
            });
        }

        next(); // Tiene permiso, lo dejamos pasar
    };
};