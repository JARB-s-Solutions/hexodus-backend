import { Router } from 'express';
import {
    getConfiguracion, getConfiguracionRuntime, actualizarConfiguracionTotal,
    actualizarApariencia, actualizarTicket,
    eliminarLogoApariencia, eliminarLogoTicket,
    restablecerSistema, restablecerApariencia, restablecerTicket
} from '../controller/configuracionController.js';
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();


// TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN

router.use(verificarToken);


// LECTURA GLOBAL DE RUNTIME (solo requiere autenticación)
// Usada por tema, logos y tickets en cualquier módulo.
router.get('/sistema/runtime', getConfiguracionRuntime);

// LECTURA ADMINISTRATIVA (Requiere permiso: configuracion.ver)
router.get('/sistema', verificarPermiso("configuracion", "ver"), getConfiguracion);



// EDICIÓN (Requiere permiso: configuracion.editar)
router.put('/sistema', verificarPermiso("configuracion", "editar"), actualizarConfiguracionTotal);
router.patch('/sistema/apariencia', verificarPermiso("configuracion", "editar"), actualizarApariencia);
router.patch('/sistema/ticket', verificarPermiso("configuracion", "editar"), actualizarTicket);

// Borrado de logos
router.delete('/sistema/logo-apariencia', verificarPermiso("configuracion", "editar"), eliminarLogoApariencia);
router.delete('/sistema/logo-ticket', verificarPermiso("configuracion", "editar"), eliminarLogoTicket);

// ==========================================
// RESTABLECER VALORES DE FÁBRICA
// ==========================================
router.post('/sistema/restablecer', verificarPermiso('configuracion', 'editar'), restablecerSistema);
router.post('/sistema/apariencia/restablecer', verificarPermiso('configuracion', 'editar'), restablecerApariencia);
router.post('/sistema/ticket/restablecer', verificarPermiso('configuracion', 'editar'), restablecerTicket);

export default router;
