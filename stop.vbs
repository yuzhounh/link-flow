Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Dim pyExe
pyExe = "C:\ProgramData\Anaconda3\python.exe"
If Not CreateObject("Scripting.FileSystemObject").FileExists(pyExe) Then
    pyExe = "python.exe"
End If

' Run stop.py silently (0 = hidden window), and wait for it to finish (True)
Dim exitCode
exitCode = WshShell.Run("""" & pyExe & """ server/stop.py", 0, True)

If exitCode = 0 Then
    WshShell.Popup "LinkFlow has been stopped safely.", 2, "LinkFlow", 64
Else
    WshShell.Popup "LinkFlow was not stopped. No unrelated process was terminated.", 4, "LinkFlow", 48
End If
