@echo off
setlocal
cd /d "%~dp0"
title ComptaOS - Developpement local et LAN

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js est introuvable. Installez Node.js puis relancez ce fichier.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo npm est introuvable. Verifiez votre installation Node.js.
  pause
  exit /b 1
)
if not exist "node_modules\concurrently\dist\bin\concurrently.js" goto dependencies
if not exist "backend\node_modules\.bin\tsx.cmd" goto dependencies
if not exist "frontend\node_modules\.bin\vite.cmd" goto dependencies

rem Le frontend expose aussi /api sur le LAN via son proxy Vite.
rem Garder le backend local et permettre les cookies de connexion en HTTP dev.
set "NODE_ENV=development"
set "HOST=127.0.0.1"
set "PORT=3001"
set "AUTH_ENABLED=true"
set "HTTPS_ONLY=false"
set "BASE_PATH=/"
set "API_TARGET=http://127.0.0.1:3001"

echo.
echo ComptaOS - acces navigateur :
echo   Local : http://localhost:5173
node -e "for(const list of Object.values(require('node:os').networkInterfaces()))for(const a of list||[])if(a.family==='IPv4'&&!a.internal)console.log('  LAN   : http://'+a.address+':5173');"
echo.
echo Autorisez Node.js sur le reseau prive si Windows le demande.
echo Les ports 3001 et 5173 doivent etre libres.
echo Ctrl+C pour arreter le frontend et le backend.
echo.

call node "node_modules\concurrently\dist\bin\concurrently.js" --kill-others --names "backend,frontend" --prefix-colors "cyan,magenta" "npm run dev --prefix backend" "npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173 --strictPort"
echo.
echo ComptaOS est arrete. En cas d'erreur, consultez les messages ci-dessus.
pause
exit /b

:dependencies
echo Dependances manquantes. Depuis ce dossier, executez :
echo   npm run install:all
echo Puis relancez ce fichier.
pause
exit /b 1
