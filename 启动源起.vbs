'==========================================================================
' 源起静默启动器  ·  Genesis Silent Launcher   （推荐日常双击使用）
'==========================================================================
' 双击之后：完全静默后台运行，不弹黑框。
'   1. 用 pythonw.exe 无黑框拉起源起控制台 (yuanqi_console.py)
'   2. 控制台会自动拉起后端 (8080) 与前端 (3000)，并自动打开浏览器控制面板
'   3. 面板地址  : http://127.0.0.1:17580/
'   4. 停止服务  : 面板上点「全部停止」，或运行 停止源起.bat
'==========================================================================

Function HttpOk(url)
    Dim http
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    On Error Resume Next
    http.Open "GET", url, False
    http.Send
    If Err.Number <> 0 Then
        HttpOk = False
    Else
        HttpOk = (http.Status = 200)
    End If
    On Error GoTo 0
End Function

Dim sh, fso, pyw, script
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

pyw    = "C:\Users\khy\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"
script = fso.GetParentFolderName(WScript.ScriptFullName) & "\yuanqi_console.py"

If Not fso.FileExists(pyw) Then
    MsgBox "找不到 pythonw.exe：" & vbCrLf & pyw & vbCrLf & vbCrLf & _
           "请改用 启动源起.bat 排障。", vbCritical, "源起启动失败"
    WScript.Quit 1
End If

If Not fso.FileExists(script) Then
    MsgBox "找不到 yuanqi_console.py：" & vbCrLf & script, vbCritical, "源起启动失败"
    WScript.Quit 1
End If

' 0 = 窗口完全隐藏；False = 异步运行
sh.Run """" & pyw & """ """ & script & """", 0, False

Dim i, ok
ok = False
For i = 1 To 20
    WScript.Sleep 1000
    If HttpOk("http://127.0.0.1:17580/api/status") Then
        ok = True
        Exit For
    End If
Next

If Not ok Then
    MsgBox "源起控制面板 20 秒内未就绪（127.0.0.1:17580 无响应）。" & vbCrLf & vbCrLf & _
           "请改用 启动源起.bat 查看控制台报错日志。", _
           vbExclamation, "源起启动提示"
End If
