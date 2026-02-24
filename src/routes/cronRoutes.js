import { Router } from "express";
import { limpiarOfertasExpiradas } from "../controller/cronController.js";

const router = Router();

// Usaremos el CRON_SECRET dentro del controlador.
router.get("/limpiar-ofertas", limpiarOfertasExpiradas);

export default router;