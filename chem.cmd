@echo off
rem ChemEngine local launcher (Windows) — no global install needed.
setlocal
cd /d "%~dp0"
node "%~dp0src\cli\index.ts" %*
endlocal