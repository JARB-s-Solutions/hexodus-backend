import { Router } from "express";
import { 
    abrirCaja,
    consultarCorte,
    realizarCorte,
    listarCortes,
    obtenerCorteDetalle
} from "../controller/cajaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta para abrir caja
router.post("/abrir", verificarToken, abrirCaja);
// Ruta para consultar corte
router.post("/consultar", verificarToken, consultarCorte);
// Ruta para realizar corte
router.post("/cerrar", verificarToken, realizarCorte);
// Ruta para listar cortes
router.get("/cortes", verificarToken, listarCortes);
// Ruta para obtener detalle de un corte
router.get("/cortes/:id", verificarToken, obtenerCorteDetalle);

export default router;