import { Router } from "express";
import { ejecutarMantenimientoDiario } from "../controller/cronController.js";

const router = Router();
// Se protege con el CRON_SECRET en los headers.
router.post("/mantenimiento-diario", ejecutarMantenimientoDiario);

// Sí usa verificarToken para asegurar que solo un Admin logueado pueda activarlo.
router.post("/sincronizar-manual", verificarToken, verificarPermiso("configuracion", "editar"), ejecutarMantenimientoDiario);

export default router;