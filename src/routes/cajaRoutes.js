import { Router } from "express";
import { 
    abrirCaja,
    consultarCorte,
    realizarCorte
} from "../controller/cajaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta para abrir caja
router.post("/abrir", verificarToken, abrirCaja);
// Ruta para consultar corte
router.post("/consultar", verificarToken, consultarCorte);
// Ruta para realizar corte
router.post("/cerrar", verificarToken, realizarCorte);

export default router;