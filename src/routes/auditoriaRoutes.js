import { Router } from "express";
import { listarLogs } from "../controller/auditoriaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

router.use(verificarToken);

// Solo usuarios con permiso de 'verReporteFinanciero' o similar pueden auditar
router.get("/", verificarPermiso("reportes", "verReporteFinanciero"), listarLogs);

export default router;