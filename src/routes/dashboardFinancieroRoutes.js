import { Router } from "express";
import { obtenerResumenFinanciero, obtenerGraficasFinancieras } from "../controller/dashboardFinancieroController.js";
import { obtenerComparacionesFinancieras } from "../controller/dashboardComparacionesController.js";
import { listarHistorialReportes, generarReporteFinanciero } from "../controller/reporteFinancieroController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);


// Permisos por acción (Módulo: reportes)


// Rutas de visualización (Requieren permiso para ver reportes financieros)
router.get("/resumen", verificarPermiso("reportes", "verReporteFinanciero"), obtenerResumenFinanciero);
router.get("/graficas", verificarPermiso("reportes", "verReporteFinanciero"), obtenerGraficasFinancieras);
router.get("/comparaciones", verificarPermiso("reportes", "verReporteFinanciero"), obtenerComparacionesFinancieras);
router.get("/historial-reportes", verificarPermiso("reportes", "verReporteFinanciero"), listarHistorialReportes);

// Rutas de creación (Requiere permiso para crear reportes)
router.post("/generar-reporte", verificarPermiso("reportes", "crear"), generarReporteFinanciero);

export default router;