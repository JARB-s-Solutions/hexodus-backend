import { Router } from 'express';
import { 
    getConfiguracion, actualizarConfiguracionTotal, 
    actualizarApariencia, actualizarTicket, 
    eliminarLogoApariencia, eliminarLogoTicket, 
    restablecerSistema, restablecerApariencia, restablecerTicket
} from '../controller/configuracionController.js';
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN BASE
router.use(verificarToken);

// LECTURA GLOBAL (Para consumo de UI en todo el sistema)
// Accesible para cualquier usuario autenticado (No requiere permisos especiales)
router.get('/sistema/global', getConfiguracion);


// LECTURA ADMINISTRATIVA (Para el módulo de Configuración)
router.get('/sistema', verificarPermiso("configuracion", "ver"), getConfiguracion);


// EDICIÓN (Requiere permiso: configuracion.editar)
router.put('/sistema', verificarPermiso("configuracion", "editar"), actualizarConfiguracionTotal);
router.patch('/sistema/apariencia', verificarPermiso("configuracion", "editar"), actualizarApariencia);
router.patch('/sistema/ticket', verificarPermiso("configuracion", "editar"), actualizarTicket);

// Borrado de logos individuales
router.delete('/sistema/logo-apariencia', verificarPermiso("configuracion", "editar"), eliminarLogoApariencia);
router.delete('/sistema/logo-ticket', verificarPermiso("configuracion", "editar"), eliminarLogoTicket);

// RESTABLECER VALORES DE FÁBRICA
router.post('/sistema/restablecer', verificarPermiso('configuracion', 'editar'), restablecerSistema);
router.post('/sistema/apariencia/restablecer', verificarPermiso('configuracion', 'editar'), restablecerApariencia);
router.post('/sistema/ticket/restablecer', verificarPermiso('configuracion', 'editar'), restablecerTicket);

export default router;