@echo off
title Sistema Contabil
cd /d "%~dp0"
start "" http://localhost:3000/admin/
start "" http://localhost:3000/
node server.js
pause
