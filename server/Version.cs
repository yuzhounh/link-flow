using System;

namespace LinkFlow;

internal static class AppInfo
{
    public const string Version = "0.3.0";
    public const int DefaultPort = 5837;
    public const long MaxUploadBytes = 256L * 1024 * 1024;
    public const long MaxRequestBytes = MaxUploadBytes + 2L * 1024 * 1024;
    public const string WindowTitle = "LinkFlow - 文件传输助手";
    public const string MutexName = @"Local\LinkFlow.SingleInstance";
}
