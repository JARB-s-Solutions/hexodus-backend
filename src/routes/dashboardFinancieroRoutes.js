import { Router } from "express";
import { obtenerResumenFinanciero, obtenerGraficasFinancieras } from "../controller/dashboardFinancieroController.js";
import { obtenerComparacionesFinancieras } from "../controller/dashboardComparacionesController.js";
import { listarHistorialReportes, generarReporteFinanciero } from "../controller/reporteFinancieroController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// GET /api/financiero/resumen
router.get("/resumen", verificarToken, obtenerResumenFinanciero);
// GET /api/financiero/graficas
router.get("/graficas", verificarToken, obtenerGraficasFinancieras);
// GET /api/financiero/comparaciones
router.get("/comparaciones", verificarToken, obtenerComparacionesFinancieras);
// GET /api/financiero/historial-reportes
router.get("/historial-reportes", verificarToken, listarHistorialReportes);
// POST /api/financiero/generar-reporte
router.post("/generar-reporte", verificarToken, generarReporteFinanciero);

export default router;