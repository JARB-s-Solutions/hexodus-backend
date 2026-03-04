import { Router } from "express";
import { registrarMovimiento, listarMovimientos, obtenerComparacionMovimientos } from "../controller/cajaMovimientosController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Endpoint para registrar un movimiento manual
router.post("/", verificarToken, registrarMovimiento);
// Endpoint para obtener comparaciones de movimientos
router.get("/comparacion", verificarToken, obtenerComparacionMovimientos);
// Endpoint para listar movimientos con filtros y KPIs
router.get("/", verificarToken, listarMovimientos);
export default router;