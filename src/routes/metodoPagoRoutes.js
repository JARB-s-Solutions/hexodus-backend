import { Router } from "express";
import { crearMetodoPago, listarMetodosPago } from "../controller/metodoPagoController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// Permisos por acción

// Listar los métodos de pago (Para llenar los select al momento de cobrar)
router.get("/", verificarPermiso("ventas", "ver"), listarMetodosPago);

// Crear un nuevo método de pago (Acción administrativa)
router.post("/", verificarPermiso("configuracion", "gestionarSistema"), crearMetodoPago);

export default router;