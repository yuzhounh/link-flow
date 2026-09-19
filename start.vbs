Set WshShell = CreateObject("WScript.Shell")
Dim scriptDir
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

Dim pyExe
pyExe = "C:\ProgramData\Anaconda3\pythonw.exe"
If Not CreateObject("Scripting.FileSystemObject").FileExists(pyExe) Then
    pyExe = "pythonw.exe"
End If

WshShell.Run """" & pyExe & """ """ & scriptDir & "\main.py""", 0, False
