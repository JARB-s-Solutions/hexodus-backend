import { Router } from "express";
import { registrarMovimiento, listarMovimientos, obtenerComparacionMovimientos, eliminarMovimiento } from "../controller/cajaMovimientosController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// Permisos por acción

// Endpoint para registrar un movimiento manual (ingreso/egreso)
router.post("/", verificarPermiso("movimientos", "crear"), registrarMovimiento);

// Endpoint para obtener comparaciones de movimientos (KPIs / Gráficas)
router.get("/comparacion", verificarPermiso("movimientos", "verComparaciones"), obtenerComparacionMovimientos);

// Endpoint para listar movimientos con filtros y KPIs
router.get("/", verificarPermiso("movimientos", "ver"), listarMovimientos);
// Endpoint para eliminar un movimiento (solo admin)
router.delete("/:id", verificarPermiso("movimientos", "eliminar"), eliminarMovimiento);
export default router;