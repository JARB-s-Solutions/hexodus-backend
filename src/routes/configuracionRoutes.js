import { Router } from 'express';
import { 
    getConfiguracion, actualizarConfiguracionTotal, 
    actualizarApariencia, actualizarTicket, 
    eliminarLogoApariencia, eliminarLogoTicket, 
    restablecerConfiguracion
} from '../controller/configuracionController.js';
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();


// TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN

router.use(verificarToken);


// LECTURA (Requiere permiso: configuracion.ver)

router.get('/sistema', verificarPermiso("configuracion", "ver"), getConfiguracion);

router.post('/sistema/restablecer', verificarPermiso("configuracion", "editar"), restablecerConfiguracion);


// EDICIÓN (Requiere permiso: configuracion.editar)
router.put('/sistema', verificarPermiso("configuracion", "editar"), actualizarConfiguracionTotal);
router.patch('/sistema/apariencia', verificarPermiso("configuracion", "editar"), actualizarApariencia);
router.patch('/sistema/ticket', verificarPermiso("configuracion", "editar"), actualizarTicket);

// Borrado de logos
router.delete('/sistema/logo-apariencia', verificarPermiso("configuracion", "editar"), eliminarLogoApariencia);
router.delete('/sistema/logo-ticket', verificarPermiso("configuracion", "editar"), eliminarLogoTicket);

export default router;