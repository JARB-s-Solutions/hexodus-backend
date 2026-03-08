import { Router } from "express";
import { obtenerKPIsDashboard, obtenerMetricasDashboard } from "../controller/dashboardController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// ==========================================
// Permisos por acción (Módulo: dashboard)
// ==========================================

// Ruta para obtener las tarjetas superiores (KPIs / Resumen)
router.get("/", verificarPermiso("dashboard", "ver"), obtenerKPIsDashboard);

// Ruta para obtener las métricas secundarias (Gráficas y tablas)
router.get("/metricas", verificarPermiso("dashboard", "verGraficas"), obtenerMetricasDashboard);

export default router;