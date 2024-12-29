// index.js
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const dotenv = require('dotenv');

// Carga .env en local (Render lo ignora y usa su panel "Environment" en producción)
dotenv.config();

const app = express();

// Opcional: Seguridad básica con Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// CORS (si te hace falta)
app.use(cors());

// Servir la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Generamos /env-config.js con tus variables de entorno
app.get('/env-config.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  // AQUÍ es donde leemos las variables de entorno de Render (.env en local)
  const envVars = {
    FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || '',
    FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN || '',
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || '',
    FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    FIREBASE_APP_ID: process.env.FIREBASE_APP_ID || ''
    // Si necesitas más, agrégalas aquí
  };

  // Retornamos un script donde metemos las variables en "window.ENV"
  res.send(`window.ENV = ${JSON.stringify(envVars)};`);
});

// Rutas para servir index.html y menu.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});
