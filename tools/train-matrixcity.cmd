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
set "NO_COLOR=1"
set "WANDB_MODE=disabled"

if not exist "%DATA%\train-env\Scripts\ns-train.exe" (
  echo Missing isolated training environment: %DATA%\train-env 1>&2
  exit /b 1
)
if not exist "%DATA%\training\small_city_block_3_half\transforms.json" (
  echo Missing prepared training images 1>&2
  exit /b 1
)
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
set "LIB=%CUDA_HOME%\lib;%LIB%"

set "STEPS=%~1"
if "%STEPS%"=="" set "STEPS=3000"
set "NAME=%~2"
if "%NAME%"=="" set "NAME=matrixcity-block3-train"

if "%~3"=="" (
  "%DATA%\train-env\Scripts\ns-train.exe" splatfacto --max-num-iterations %STEPS% --steps-per-save 500 --vis tensorboard --output-dir "%DATA%\outputs" --experiment-name "%NAME%" --pipeline.model.stop-split-at 2000 nerfstudio-data --data "%DATA%\training\small_city_block_3_half"
) else (
  "%DATA%\train-env\Scripts\ns-train.exe" splatfacto --max-num-iterations %STEPS% --steps-per-save 500 --vis tensorboard --output-dir "%DATA%\outputs" --experiment-name "%NAME%" --load-dir "%~3" --pipeline.model.stop-split-at 2000 nerfstudio-data --data "%DATA%\training\small_city_block_3_half"
)
exit /b %ERRORLEVEL%
