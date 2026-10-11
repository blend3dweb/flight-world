@echo off
cd /d "%~dp0"
node launch-webgpu.cjs --mgu
if errorlevel 1 pause
