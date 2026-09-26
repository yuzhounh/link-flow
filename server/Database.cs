using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace LinkFlow;

/// <summary>SQLite access for data/messages.db.</summary>
internal sealed class MessageDb
{
    private readonly string _connectionString;

    public MessageDb(string path)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString();
        Execute(@"CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    timestamp INTEGER NOT NULL,
                    sender TEXT NOT NULL,
                    msg_type TEXT NOT NULL,
                    content TEXT,
                    file_name TEXT,
                    file_path TEXT,
                    file_size INTEGER DEFAULT 0,
                    mime_type TEXT,
                    thumb_path TEXT
                )");
        Execute("CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp DESC)");
    }

    private SqliteCommand Prepare(SqliteConnection connection, string sql, object?[] args)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        for (int i = 0; i < args.Length; i++) command.Parameters.AddWithValue("$p" + i, args[i] ?? DBNull.Value);
        return command;
    }

    private int Execute(string sql, params object?[] args)
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var command = Prepare(connection, sql, args);
        return command.ExecuteNonQuery();
    }

    private List<Dictionary<string, object?>> Query(string sql, params object?[] args)
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var command = Prepare(connection, sql, args);
        using var reader = command.ExecuteReader();
        var rows = new List<Dictionary<string, object?>>();
        while (reader.Read())
        {
            var row = new Dictionary<string, object?>(reader.FieldCount);
            for (int i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    public void Insert(Dictionary<string, object?> m) => Execute(
        "INSERT INTO messages (id, timestamp, sender, msg_type, content, file_name, file_path, file_size, mime_type, thumb_path) " +
        "VALUES ($p0, $p1, $p2, $p3, $p4, $p5, $p6, $p7, $p8, $p9)",
        m["id"], m["timestamp"], m["sender"], m["msg_type"], m["content"], m["file_name"], m["file_path"],
        m["file_size"], m["mime_type"], m["thumb_path"]);

    public List<Dictionary<string, object?>> GetMessages(int limit, long? beforeTs, string? search, string? month)
    {
        var sql = new StringBuilder("SELECT * FROM messages WHERE 1=1");
        var args = new List<object?>();

        if (month != null)
        {
            try
            {
                string[] parts = month.Split('-');
                if (parts.Length == 2)
                {
                    int y = int.Parse(parts[0], CultureInfo.InvariantCulture);
                    int m = int.Parse(parts[1], CultureInfo.InvariantCulture);
                    var start = new DateTime(y, m, 1, 0, 0, 0, DateTimeKind.Local);
                    var end = start.AddMonths(1);
                    sql.Append($" AND timestamp >= $p{args.Count}");
                    args.Add(new DateTimeOffset(start).ToUnixTimeMilliseconds());
                    sql.Append($" AND timestamp < $p{args.Count}");
                    args.Add(new DateTimeOffset(end).ToUnixTimeMilliseconds());
                }
            }
            catch (Exception ex)
            {
                AppLog.Warn("LinkFlow.Database", $"Invalid month parameter '{month}': {ex.Message}");
            }
        }

        if (beforeTs is > 0)
        {
            sql.Append($" AND timestamp < $p{args.Count}");
            args.Add(beforeTs.Value);
        }

        if (search != null)
        {
            sql.Append($" AND (content LIKE $p{args.Count} OR file_name LIKE $p{args.Count})");
            args.Add($"%{search}%");
        }

        if (month != null)
        {
            sql.Append(" ORDER BY timestamp ASC LIMIT 10000");
            return Query(sql.ToString(), args.ToArray());
        }

        sql.Append($" ORDER BY timestamp DESC LIMIT $p{args.Count}");
        args.Add(limit);
        var rows = Query(sql.ToString(), args.ToArray());
        rows.Reverse(); // oldest first for the chat timeline
        return rows;
    }

    public Dictionary<string, object?>? GetById(string id) =>
        Query("SELECT * FROM messages WHERE id = $p0", id).FirstOrDefault();

    public Dictionary<string, object?>? Delete(string id)
    {
        var message = GetById(id);
        if (message != null) Execute("DELETE FROM messages WHERE id = $p0", id);
        return message;
    }

    public int ClearAll() => Execute("DELETE FROM messages");

    public Dictionary<string, object?> GetStats()
    {
        var row = Query("SELECT COUNT(*) AS total, SUM(file_size) AS size FROM messages").FirstOrDefault();
        return new Dictionary<string, object?>
        {
            ["total_messages"] = row?["total"] ?? 0L,
            ["total_file_size"] = row?["size"] ?? 0L,
        };
    }

    public List<Dictionary<string, object?>> GetRecordedMonths() => Query(@"
        SELECT
            strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime') AS month,
            COUNT(*) AS count,
            COALESCE(SUM(file_size), 0) AS total_file_size
        FROM messages
        WHERE timestamp IS NOT NULL
        GROUP BY month
        ORDER BY month DESC");
}
