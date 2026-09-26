Set WshShell = CreateObject("WScript.Shell")
Dim scriptDir
Dim fileSystem
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

Dim pyExe
pyExe = scriptDir & "\.venv\Scripts\pythonw.exe"
If Not fileSystem.FileExists(pyExe) Then
    pyExe = "C:\ProgramData\Anaconda3\pythonw.exe"
    If Not fileSystem.FileExists(pyExe) Then
        pyExe = "pythonw.exe"
    End If
End If

WshShell.Run """" & pyExe & """ """ & scriptDir & "\main.py""", 0, False
