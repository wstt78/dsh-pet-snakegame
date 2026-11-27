@echo off
setlocal
rem Build the read-only global input helper with the .NET Framework csc
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [FAIL] csc.exe not found; .NET Framework 4.x is required
  exit /b 1
)
"%CSC%" /nologo /optimize+ /target:exe /out:"%~dp0..\bin\input-helper.exe" "%~dp0..\src\input-helper.cs"
if errorlevel 1 (
  echo [FAIL] compile failed
  exit /b 1
)
echo [OK] bin\input-helper.exe
