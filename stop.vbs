Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Dim pyExe
pyExe = "C:\ProgramData\Anaconda3\python.exe"
If Not CreateObject("Scripting.FileSystemObject").FileExists(pyExe) Then
    pyExe = "python.exe"
End If

' Run stop.py silently (0 = hidden window), and wait for it to finish (True)
WshShell.Run """" & pyExe & """ server/stop.py", 0, True

' Show a friendly popup that auto-closes in 2 seconds (64 = Info icon)
WshShell.Popup "LinkFlow service has been stopped.", 2, "LinkFlow", 64
