import { Router } from "express";
import { listarConceptos, crearConcepto } from "../controller/conceptoController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// ==========================================
// Permisos por acción (Módulo: movimientos)
// ==========================================

// Obtener la lista de conceptos (para llenar selects)
router.get("/", verificarPermiso("movimientos", "ver"), listarConceptos);

// Crear un nuevo concepto financiero
router.post("/", verificarPermiso("movimientos", "crear"), crearConcepto);

export default router;