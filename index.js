const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const PDFParser = require('pdf-parse');
const sharp = require('sharp');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const hpp = require('hpp');
const { validationResult, check } = require('express-validator');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');

// Cargar variables de entorno
dotenv.config();

// Inicializar Express
const app = express();

// Inicializar Firebase Admin
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin inicializado correctamente");
} catch (error) {
    console.error("Error al inicializar Firebase Admin:", error);
    process.exit(1);
}

// Configuración de multer para subida de archivos
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB máximo
        files: 3
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Tipo de archivo no permitido'), false);
        }
        cb(null, true);
    }
});

// Configuración de Helmet con CSP actualizado
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://*.gstatic.com",
                "https://*.google.com",
                "https://apis.google.com"
            ],
            connectSrc: [
                "'self'",
                "https://*.googleapis.com",
                "https://*.google.com",
                "https://identitytoolkit.googleapis.com",
                "https://securetoken.googleapis.com",
                "https://accounts.google.com",
                "https://*.firebaseapp.com"
            ],
            frameSrc: [
                "'self'",
                "https://*.google.com",
                "https://*.firebaseapp.com",
                "https://accounts.google.com"
            ],
            formAction: [
                "'self'",
                "https://accounts.google.com",
                "https://*.firebaseapp.com"
            ],
            imgSrc: [
                "'self'", 
                "data:", 
                "https:", 
                "https://*.google.com", 
                "https://*.googleusercontent.com"
            ],
            styleSrc: [
                "'self'", 
                "'unsafe-inline'", 
                "https://fonts.googleapis.com"
            ],
            fontSrc: [
                "'self'", 
                "https://fonts.gstatic.com"
            ],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
}));

// Middlewares de seguridad y optimización
app.use(xss());
app.use(hpp());
app.use(compression());
app.use(mongoSanitize());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas solicitudes, intente más tarde' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Inicializar OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Middleware de autenticación
const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Token no proporcionado',
                details: 'Se requiere un token de autenticación válido'
            });
        }

        const token = authHeader.split('Bearer ')[1];
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            req.user = decodedToken;
            next();
        } catch (tokenError) {
            console.error('Error al verificar token:', tokenError);
            return res.status(403).json({
                error: 'Token inválido',
                details: 'El token proporcionado no es válido o ha expirado'
            });
        }
    } catch (error) {
        console.error('Error en autenticación:', error);
        return res.status(500).json({
            error: 'Error de autenticación',
            details: 'Error interno en el proceso de autenticación'
        });
    }
};

// Validaciones para el chat
const validateChat = [
    check('message').trim().notEmpty().withMessage('El mensaje es requerido'),
    check('category').trim().notEmpty().withMessage('La categoría es requerida')
];

// Control de caché
const cacheControl = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
};

// Rutas
app.get('/env-config.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    const envVars = {
        FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || '',
        FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN || '',
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
        FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || '',
        FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        FIREBASE_APP_ID: process.env.FIREBASE_APP_ID || ''
    };
    res.send(`window.ENV = ${JSON.stringify(envVars)};`);
});

// Rutas principales
app.get('/', cacheControl, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/menu', cacheControl, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/menu.html'));
});

app.get('/chat', cacheControl, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/chat.html'));
});

app.get('/document-chat', cacheControl, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/document-chat.html'));
});

// Manejo de redirecciones de autenticación
app.get('/__/auth/*', (req, res) => {
    console.log('Redireccionando desde auth callback');
    res.redirect('/menu');
});

// Middleware para rutas no encontradas
app.use((req, res, next) => {
    if (req.path.startsWith('/__/auth/')) {
        res.redirect('/menu');
        return;
    }
    next();
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'Archivo demasiado grande',
                details: 'El tamaño máximo permitido es 20MB'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                error: 'Demasiados archivos',
                details: 'Máximo 3 archivos permitidos'
            });
        }
    }

    res.status(500).json({
        error: 'Error interno del servidor',
        details: process.env.NODE_ENV === 'development' ? err.message : 'Error interno'
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Manejo de señales de terminación
process.on('SIGINT', () => {
    console.log('Received SIGINT. Graceful shutdown initiated...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Graceful shutdown initiated...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});