import { Router } from "express";
import { 
    abrirCaja,
    consultarCorte,
    realizarCorte,
    listarCortes,
    obtenerCorteDetalle
} from "../controller/cajaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas de caja requieren un token válido
router.use(verificarToken);

// Permisos por acción

// Ruta para abrir caja (Requiere el permiso especial de crear cortes)
router.post("/abrir", verificarPermiso("ventas", "crearCorte"), abrirCaja);

// Ruta para consultar el corte actual / movimientos flotantes
router.post("/consultar", verificarPermiso("ventas", "verCortesAnteriores"), consultarCorte);

// Ruta para cerrar/realizar el corte
router.post("/cerrar", verificarPermiso("ventas", "crearCorte"), realizarCorte);

// Ruta para ver el historial de todos los cortes
router.get("/cortes", verificarPermiso("ventas", "verCortesAnteriores"), listarCortes);

// Ruta para ver el detalle exacto de un corte (modal)
router.get("/cortes/:id", verificarPermiso("ventas", "verCortesAnteriores"), obtenerCorteDetalle);

export default router;