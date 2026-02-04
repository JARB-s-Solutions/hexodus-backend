import { Router } from 'express';
import { crearSocio, obtenerSocios } from '../controllers/sociosController.js';

const router = Router();

// GET /api/socios
router.get('/', obtenerSocios);

// POST /api/socios
router.post('/', crearSocio);

export default router;