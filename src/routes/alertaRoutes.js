import { Router } from "express";
import { 
    obtenerAlertas, 
    actualizarEstadoAlerta, 
    obtenerConfiguracion, 
    actualizarConfiguracion 
} from "../controller/alertaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();
router.use(verificarToken);

// Gestión de alertas
router.get("/", obtenerAlertas);
router.patch("/:id/estado", actualizarEstadoAlerta);

// Configuración (Solo Admins)
router.get("/configuracion", verificarPermiso("configuracion", "ver"), obtenerConfiguracion);
router.put("/configuracion", verificarPermiso("configuracion", "editar"), actualizarConfiguracion);

export default router;