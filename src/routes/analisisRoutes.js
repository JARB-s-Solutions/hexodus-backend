import { Router } from "express";
import { obtenerAnalisisVentas } from "../controller/analisisController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Exigimos token para todas las rutas de este archivo
router.use(verificarToken);

// Permisos por acción

// Endpoint del Dashboard de Análisis
router.get("/ventas", verificarPermiso("ventas", "verAnalisis"), obtenerAnalisisVentas);

export default router;