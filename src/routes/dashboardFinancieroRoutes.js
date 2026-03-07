import { Router } from "express";
import { obtenerResumenFinanciero } from "../controller/dashboardFinancieroController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// GET /api/financiero/resumen
router.get("/resumen", verificarToken, obtenerResumenFinanciero);

export default router;