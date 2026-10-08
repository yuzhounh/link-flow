using System;

namespace LinkFlow;

internal static class AppInfo
{
    public static readonly string Version = typeof(AppInfo).Assembly.GetName().Version?.ToString(3) ?? "unknown";
    public const int DefaultPort = 5837;
    public const long MaxUploadBytes = 256L * 1024 * 1024;
    public const long MaxRequestBytes = MaxUploadBytes + 2L * 1024 * 1024;
    public const string WindowTitle = "LinkFlow - 文件传输助手";
    public const string MutexName = @"Local\LinkFlow.SingleInstance";
}
