import { Router } from "express";
import { obtenerResumenFinanciero, obtenerGraficasFinancieras } from "../controller/dashboardFinancieroController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// GET /api/financiero/resumen
router.get("/resumen", verificarToken, obtenerResumenFinanciero);
// GET /api/financiero/graficas
router.get("/graficas", verificarToken, obtenerGraficasFinancieras);

export default router;