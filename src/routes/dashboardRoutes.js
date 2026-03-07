import { Router } from "express";
import { obtenerKPIsDashboard, obtenerMetricasDashboard } from "../controller/dashboardController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta para obtener las tarjetas superiores
router.get("/", verificarToken, obtenerKPIsDashboard);
// Ruta para obtener las métricas secundarias (gráficas y tablas)
router.get("/metricas", verificarToken, obtenerMetricasDashboard);

export default router;