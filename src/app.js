import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes/index.js';
import router from './routes/index.js';
import sociosRoutes from './routes/sociosRoutes.js';

// Initializar Express app

const app = express();

// Seguridas básica (Headers HTTP)
app.use(helmet());

// Logger de peticiones
app.use(morgan('dev'));

// Parseo del cuerpo de las peticiones como JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Habilitar CORS
app.use(cors());

app.use('/api', routes);

router.use('/socios', sociosRoutes);

// RUTA DE PRUEBA
app.get("/", (req, res) => {
    res.json({
        message: "HEXODUS API funcionando correctamente",
        status: "success",
        timestamp: new Date().toISOString()
    });
});

export default app;