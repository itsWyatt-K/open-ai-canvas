' 兼容入口：自动跳转至 启动源起.vbs
Dim sh, fso, target
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
target = fso.GetParentFolderName(WScript.ScriptFullName) & "\启动源起.vbs"
sh.Run """" & target & """", 0, False
