import { Router } from "express";
import { ejecutarMantenimientoDiario } from "../controller/cronController.js";

const router = Router();
// Se protege con el CRON_SECRET en los headers.
router.post("/mantenimiento-diario", ejecutarMantenimientoDiario);

export default router;