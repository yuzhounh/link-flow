Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Dim pyExe
pyExe = "C:\ProgramData\Anaconda3\pythonw.exe"
If Not CreateObject("Scripting.FileSystemObject").FileExists(pyExe) Then
    pyExe = "pythonw.exe"
End If

WshShell.Run """" & pyExe & """ main.py", 0, False
