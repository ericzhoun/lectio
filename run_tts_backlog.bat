@echo off
REM 续跑全量课表音频（Kokoro 引擎，en=af_heart / zh=zm_yunxi）。
REM 可随时 Ctrl+C 中断；重新运行会自动跳过已完成的日期，只补缺的。
REM 预计 GPU 连续运行二十小时上下，建议在不用电脑时挂机执行。
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set HF_HOME=E:\workplace\TTS-cache\hf
set HF_HUB_DISABLE_SYMLINKS=1
set SSL_CERT_FILE=
cd /d D:\workplace\lectio
npx tsx scripts/tts/passages.mts --all --yes --engine kokoro
pause
