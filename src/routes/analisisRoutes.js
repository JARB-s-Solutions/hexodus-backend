import { Router } from "express";
import { obtenerAnalisisVentas } from "../controller/analisisController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Endpoint del Dashboard de Análisis
router.get("/ventas", verificarToken, obtenerAnalisisVentas);

export default router;