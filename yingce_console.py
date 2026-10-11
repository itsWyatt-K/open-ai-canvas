# -*- coding: utf-8 -*-
"""
影策控制台兼容适配层 -> 自动平滑重定向至「源起」控制台核心 (yuanqi_console.py)
========================================================================
系统已全面统一升级为「源起 (Genesis)」创作工作台。
本文件仅保留用于历史脚本和向后兼容，核心逻辑已全部平移至 yuanqi_console.py。
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from yuanqi_console import *
from yuanqi_console import main

if __name__ == "__main__":
    main()
