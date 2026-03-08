import { Router } from "express";
import { registrarCompra } from "../controller/compraController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// Permisos por acción (Módulo: inventario)

// Ruta para registrar una compra (abastecer stock)
router.post("/", verificarPermiso("inventario", "crear"), registrarCompra);

export default router;