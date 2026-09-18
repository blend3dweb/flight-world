@echo off
cd /d "%~dp0"
node launch-webgpu.cjs
if errorlevel 1 pause
