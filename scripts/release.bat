@echo off
title Unreleased - Web Release
cd /d "%~dp0\.."
python scripts\python\release.py
