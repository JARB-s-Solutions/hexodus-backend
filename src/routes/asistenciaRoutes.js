import { Router } from "express";
import { validarAsistenciaFacial, obtenerHistorialAsistencias,
    obtenerAsistenciasHoy,
    obtenerAsistenciasSocio,
    registrarAsistenciaManual } from "../controller/asistenciaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js"; 

const router = Router();

// RUTAS DEL KIOSKO BIOMÉTRICO
// Nota: Dependiendo de tu seguridad, esta ruta podría usar 'verificarToken' 
// o un middleware específico para validar que la petición viene del hardware del gimnasio.
router.post("/validar", verificarToken, validarAsistenciaFacial);

// Rutas Administrativas
router.get("/", verificarToken, obtenerHistorialAsistencias);
router.get("/hoy", verificarToken, obtenerAsistenciasHoy);
router.get("/socio/:id", verificarToken, obtenerAsistenciasSocio);
router.post("/manual", verificarToken, registrarAsistenciaManual);

export default router;