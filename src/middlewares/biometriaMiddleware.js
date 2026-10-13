import prisma from '../config/prisma.js';
import { leerUsuarioBiometrico } from '../services/biometriaLecturas.js';
import { BiometricError, biometricErrorResponse } from '../utils/biometriaContrato.js';

// Sensitive biometric operations must honor role changes and disabled users immediately.
export async function cargarUsuarioActual(req, db = prisma) {
    if (req.biometricUser) return req.biometricUser;
    if (!Number.isSafeInteger(req.user?.id) || req.user.id <= 0) throw new BiometricError(401, 'SESSION_INVALID', 'La sesión no es válida.');
    const current = await leerUsuarioBiometrico(db, req.user.id);
    if (!current || current.status !== 'activo' || !current.rol) throw new BiometricError(401, 'SESSION_INACTIVE', 'La sesión ya no está autorizada. Inicia sesión nuevamente.');
    let permisos = current.rol.permisos;
    if (typeof permisos === 'string') {
        try { permisos = JSON.parse(permisos); } catch { permisos = {}; }
    }
    req.biometricUser = { id: current.id, rol: current.rol, permisos: permisos || {} };
    return req.biometricUser;
}

export async function exigirPermisosActuales(req, requirements, db = prisma) {
    const current = await cargarUsuarioActual(req, db);
    if (!current.rol.esAdministrador && requirements.some(([modulo, accion]) => current.permisos?.[modulo]?.[accion] !== true)) {
        throw new BiometricError(403, 'BIOMETRIC_PERMISSION', 'No tienes permiso para realizar esta operación biométrica.');
    }
    return current;
}

export const verificarPermisosActuales = (...requirements) => async (req, res, next) => {
    try {
        await exigirPermisosActuales(req, requirements);
        next();
    } catch (error) {
        if (!biometricErrorResponse(res, error)) res.status(503).json({ success: false, message: 'No se pudo verificar la autorización actual.' });
    }
};
