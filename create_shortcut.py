import os
import subprocess

def create_shortcut():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    start_vbs = os.path.join(base_dir, "start.vbs")
    icon_path = os.path.join(base_dir, "static", "icon.ico")
    desktop = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
    shortcut_path = os.path.join(desktop, "LinkFlow.lnk")
    description = "LinkFlow - 私人文件传输助手"

    # 1. Prefer IShellLinkW via pywin32 to preserve full Unicode strings
    try:
        import pythoncom
        from win32com.shell import shell
        shortcut = pythoncom.CoCreateInstance(
            shell.CLSID_ShellLink,
            None,
            pythoncom.CLSCTX_INPROC_SERVER,
            shell.IID_IShellLink
        )
        shortcut.SetPath("wscript.exe")
        shortcut.SetArguments(f'"{start_vbs}"')
        shortcut.SetWorkingDirectory(base_dir)
        shortcut.SetIconLocation(icon_path, 0)
        shortcut.SetDescription(description)
        persist_file = shortcut.QueryInterface(pythoncom.IID_IPersistFile)
        persist_file.Save(shortcut_path, 0)
        print(f"SUCCESS: Created shortcut at: {shortcut_path}")
        return
    except Exception as e:
        pass

    # 2. Fallback to PowerShell
    ps_script = f'''
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "LinkFlow.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = '"{start_vbs}"'
$shortcut.WorkingDirectory = "{base_dir}"
$shortcut.IconLocation = "{icon_path},0"
$shortcut.Description = "{description}"
$shortcut.Save()
Write-Host "SUCCESS: Created shortcut at: $shortcutPath"
'''
    result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True, check=True)
    print(result.stdout.strip())

if __name__ == "__main__":
    create_shortcut()

