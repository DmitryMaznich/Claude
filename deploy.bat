@echo off
echo ========================================
echo   Smart Wash - Quick Deploy to cPanel
echo ========================================
echo.

:: Get commit message from user
set /p commit_msg="Enter commit message: "
if "%commit_msg%"=="" set commit_msg="Update website"

echo.
echo [1/4] Adding files to git...
git add .

echo [2/4] Creating commit...
git commit -m "%commit_msg%"

echo [3/4] Pushing to GitHub...
git push origin main

echo.
echo [4/4] Done! cPanel will auto-deploy from GitHub.
echo.
echo ========================================
echo   Deployment complete!
echo ========================================
pause
