import { Router } from "express";
import { obtenerResumenFinanciero, obtenerGraficasFinancieras } from "../controller/dashboardFinancieroController.js";
import { obtenerComparacionesFinancieras } from "../controller/dashboardComparacionesController.js";
import { 
    listarHistorialReportes, 
    generarReporteFinanciero, 
    descargarReporte, 
    eliminarReporte 
} from "../controller/reporteFinancieroController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

router.use(verificarToken);

// RUTAS DE VISUALIZACIÓN
router.get("/resumen", verificarPermiso("reportes", "verReporteFinanciero"), obtenerResumenFinanciero);
router.get("/graficas", verificarPermiso("reportes", "verReporteFinanciero"), obtenerGraficasFinancieras);
router.get("/comparaciones", verificarPermiso("reportes", "verReporteFinanciero"), obtenerComparacionesFinancieras);
router.get("/historial-reportes", verificarPermiso("reportes", "verReporteFinanciero"), listarHistorialReportes);

// GESTIÓN DE REPORTES (Permisos Corregidos)
router.post("/generar-reporte", verificarPermiso("reportes", "crear"), generarReporteFinanciero);
router.get("/descargar-reporte/:id", verificarPermiso("reportes", "descargar"), descargarReporte);
router.delete("/eliminar-reporte/:id", verificarPermiso("reportes", "eliminar"), eliminarReporte);

export default router;