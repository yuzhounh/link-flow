import os
import subprocess

def create_shortcut():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    start_vbs = os.path.join(base_dir, "start.vbs")
    icon_path = os.path.join(base_dir, "static", "icon.ico")
    
    ps_script = f'''
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "LinkFlow.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = '"{start_vbs}"'
$shortcut.WorkingDirectory = "{base_dir}"
$shortcut.IconLocation = "{icon_path},0"
$shortcut.Description = "LinkFlow - 私人文件传输助手"
$shortcut.Save()
Write-Host "SUCCESS: Created shortcut at: $shortcutPath"
'''
    result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True, check=True)
    print(result.stdout.strip())

if __name__ == "__main__":
    create_shortcut()
