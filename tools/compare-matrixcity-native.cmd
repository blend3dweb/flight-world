@echo off
setlocal
chcp 65001 >nul
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "DATA=%ROOT%\data\matrixcity"
set "CUDA_HOME=%DATA%\cuda-min\Library"
set "PATH=%CUDA_HOME%\bin;%PATH%"
set "TORCH_CUDA_ARCH_LIST=12.0"
set "TORCH_EXTENSIONS_DIR=%DATA%\torch-extensions"
set "MAX_JOBS=1"
set "CMAKE_BUILD_PARALLEL_LEVEL=1"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
set "LIB=%CUDA_HOME%\lib;%LIB%"
"%DATA%\train-env\Scripts\python.exe" "%ROOT%\tools\compare-matrixcity-native.py"
exit /b %ERRORLEVEL%
