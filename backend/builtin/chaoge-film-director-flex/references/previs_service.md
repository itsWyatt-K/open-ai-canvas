# 本机预演自动连接

Windows本机模式使用 `scripts/previs_service.py` 与 `scripts/previs_windows_task.ps1`。用户已授权自动启动时，登记当前用户的Windows计划任务，并立即由任务计划程序启动pythonw监督程序；以后Windows登录时自动启动。任务使用当前登录用户，不提权、不保存密码、不弹命令行窗口。服务独立于Codex，关闭或重启Codex不应结束服务；打开已有聊天时直接点击原HTTP链接，不要求先向AI发消息。不修改Codex程序、不建立公网端口。

不要把“隐藏窗口”当成独立运行。直接从Codex用Popen启动，即使用CREATE_NO_WINDOW或DETACHED_PROCESS，也可能留在Codex的退出清理进程组中。必须通过Windows任务计划程序启动；失败时报告错误，不悄悄退回上述启动方式。旧版HKCU Run仅在Windows登录触发，不能修复单独重开Codex后的离线状态；升级成功后仅移除本服务自己登记的旧Run项。

## 首次接入

1. 确认实际工程目录与用户要保留的原地址；旧工程先备份待改文件。模板包含scripts/previs-health.mjs，vite.config.ts需加载previsHealth()；已有工程仅适配这两个位置，保留scene-project、家具、人物、机位、身份及共享目录。
2. 安装锁文件依赖，使用Node >=22.13。注册前核对该工程的node_modules/vinext/dist/cli.js可用。健康插件强制仅回环地址和strictPort，端口占用不漂移。
3. 使用本Skill目录中的脚本：`python scripts/previs_service.py register <工程绝对路径> --port <原固定端口> --autostart`。占位符替换实际路径；路径有空格须正确引用。此命令会登记当前用户的计划任务并立即启动；没有自动启动授权时先说明此效果，不能因普通建模就擅自启用系统常驻。已登记工程更新启动器可执行`python scripts/previs_service.py install`，保留原登记与固定地址。
4. 运行`python scripts/previs_service.py status`，只有实时health=ready才展示“已连接”。监督锁和状态更新时间共同判断监督程序是否在线，失效快照标为stale_snapshot，不能沿用旧PID和旧ready状态。还需实际打开页面验证原有进度和同步状态，不把进程存在或端口开放当作页面成功。

登记文件在工程内.chaoge-previs-service.json，运行目录在LOCALAPPDATA/Chaoge/PrevisService。脚本先解析其真实绝对路径，计划任务通过task-launch.json固定此路径与Python运行时。注册重复执行复用身份，不重复开服务；固定端口已登记其他工程则拒绝。现有其他进程占端口时报告port_conflict，不杀掉它或切换地址。健康响应同时匹配服务种类、随机serviceId与projectKey；路径仍用于原共享存储分区，不迁移用户存档。

Codex的Windows打包环境可能虚拟化LOCALAPPDATA。首次安装时，将原Chaoge数据目录对应的真实LOCALAPPDATA保存在runtime-environment.json，之后独立运行的Node继承这个固定值，确保预演进度和模型库仍读取原存储。后续升级保留该文件；目标目录缺失时报告启动失败，不自动换到另一个空目录。不能通过重置项目或重新生成身份来掩盖存档路径错误。

## 运行与恢复

监督程序每两秒检查登记项目；子进程退出后退避重试，日志记录错误；启动超过三分钟没有正确身份响应会重启自己创建的子进程。只终止自身持有的子进程，不根据旧PID任意杀进程。监督程序未处理的异常写入supervisor.log并以非零码退出，计划任务配置一分钟后重试；任务无累计运行时限，不因电池供电停止。临时停止属于正常退出，不触发失败重启。该机制不承诺电脑休眠、断电、依赖被删或计划任务被禁用后仍在线。更新已登记工程保留服务身份，修改后核验原地址。

验证须覆盖：真实页面与原进度可用、子服务退出可恢复、重复启动不产生重复实例、无关端口占用不被接管，以及启动程序整个退出清理进程组被结束后监督程序和Node继续存活、心跳继续更新。最后一项可用Windows Job Object独立测试复现Codex退出清理；如未实际关闭并重开Codex或重启Windows，不宣称完成这些实际重启测试。

临时停止：`python scripts/previs_service.py stop`。重新启动：`python scripts/previs_service.py install`。关闭本机登录自启并停止：`python scripts/previs_service.py disable`。禁用只删除描述中匹配本运行目录的计划任务，不删除其他同名程序或项目与存档。任务名按当前用户SID区分，同名异属任务拒绝覆盖。这些命令针对当前用户登记的预演服务，停止会影响这些工程。其他系统仍使用本平台支持的启动方式，不声称Windows任务计划方案跨平台可用。

学员机器须按实际项目各自登记，Skill升级不能把超哥的绝对路径、服务身份、计划任务或私有存档带到学员电脑。模板仅提供能力；未执行接入时不能称为已经自启。发行包不包含node_modules、运行日志、.chaoge-previs-service.json、task-launch.json、runtime-environment.json或本机注册表数据。
