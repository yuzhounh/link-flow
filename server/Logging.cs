using System;
using System.Globalization;
using System.IO;
using System.Text;
using Microsoft.Extensions.Logging;

namespace LinkFlow;

/// <summary>Writes data/linkflow.log with rotation (2 MB x 3).</summary>
internal static class AppLog
{
    private static readonly object Gate = new();
    private static readonly UTF8Encoding Utf8NoBom = new(false);
    private const long MaxBytes = 2 * 1024 * 1024;

    public static string? FilePath { get; private set; }

    public static void Init(string path) => FilePath = path;
    public static void Info(string category, string message) => Write("INFO", category, message, null);
    public static void Warn(string category, string message, Exception? ex = null) => Write("WARNING", category, message, ex);
    public static void Error(string category, string message, Exception? ex = null) => Write("ERROR", category, message, ex);

    public static void Write(string level, string category, string message, Exception? ex)
    {
        string? path = FilePath;
        if (path == null) return;
        string time = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        string line = $"{time} [{level}] {category}: {message}";
        if (ex != null) line += Environment.NewLine + ex;
        line += Environment.NewLine;
        lock (Gate)
        {
            try
            {
                var info = new FileInfo(path);
                if (info.Exists && info.Length + line.Length > MaxBytes) Rotate(path);
                File.AppendAllText(path, line, Utf8NoBom);
            }
            catch
            {
                // Logging must never break the app.
            }
        }
    }

    private static void Rotate(string path)
    {
        for (int i = 3; i >= 1; i--)
        {
            string source = i == 1 ? path : $"{path}.{i - 1}";
            if (File.Exists(source)) File.Move(source, $"{path}.{i}", true);
        }
    }
}

/// <summary>Routes ASP.NET Core warnings into data/linkflow.log.</summary>
internal sealed class FileLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new FileLogger(categoryName);

    public void Dispose()
    {
    }

    private sealed class FileLogger : ILogger
    {
        private readonly string _category;

        public FileLogger(string category) => _category = category;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information && logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            string level = logLevel switch
            {
                LogLevel.Warning => "WARNING",
                LogLevel.Error => "ERROR",
                LogLevel.Critical => "CRITICAL",
                _ => "INFO",
            };
            AppLog.Write(level, _category, formatter(state, exception), exception);
        }
    }
}
