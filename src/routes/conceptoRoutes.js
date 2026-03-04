import { Router } from "express";
import { listarConceptos, crearConcepto } from "../controller/conceptoController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Obtener la lista 
router.get("/", verificarToken, listarConceptos);

// Crear uno nuevo
router.post("/", verificarToken, crearConcepto);

export default router;