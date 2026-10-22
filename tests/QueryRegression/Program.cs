using LinkFlow;
using Microsoft.Data.Sqlite;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../tmp/query-regression"));
Directory.CreateDirectory(root);
var path = Path.Combine(root, Guid.NewGuid().ToString("N") + ".db");
var db = new MessageDb(path);
long start = new DateTimeOffset(new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Local)).ToUnixTimeMilliseconds();
const int count = 10037;
using (var connection = new SqliteConnection("Data Source=" + path)) {
    connection.Open();
    using var tx = connection.BeginTransaction();
    using var command = connection.CreateCommand(); command.Transaction = tx;
    command.CommandText = "INSERT INTO messages(id,timestamp,sender,msg_type,content) VALUES($id,$ts,'pc','text','needle')";
    var id = command.Parameters.Add("$id", SqliteType.Text); var ts = command.Parameters.Add("$ts", SqliteType.Integer);
    for (int i = 0; i < count; i++) { id.Value = i.ToString("D6"); ts.Value = start + i / 43; command.ExecuteNonQuery(); }
    id.Value = "outside-before"; ts.Value = start - 1; command.ExecuteNonQuery();
    id.Value = "outside-after"; ts.Value = new DateTimeOffset(new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Local)).ToUnixTimeMilliseconds(); command.ExecuteNonQuery();
    tx.Commit();
}
void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
var seen = new HashSet<string>(); long? before = null; string? beforeId = null;
int pages = 0;
while (true) {
    var page = db.GetMessages(30, before, null, "2026-09", beforeId);
    Require(page.Count <= 30, "month ignored limit"); pages++;
    var ordered = page.Select(r => ((long)r["timestamp"]!, (string)r["id"]!)).ToArray();
    Require(ordered.SequenceEqual(ordered.OrderBy(x => x.Item1).ThenBy(x => x.Item2, StringComparer.Ordinal)), "unstable chronology");
    foreach (var row in page) Require(seen.Add((string)row["id"]!), "duplicate cursor row");
    if (page.Count < 30) break;
    before = (long)page[0]["timestamp"]!; beforeId = (string)page[0]["id"]!;
}
Require(seen.Count == count && !seen.Any(x => x.StartsWith("outside")), "missing tied timestamps or month boundary");
Require(db.GetMessages(7, null, "needle", "2026-09").Count == 7, "month search ignored limit");
Require(db.GetMessages(7, start + 5, null, "2026-09").All(r => (long)r["timestamp"]! < start + 5), "legacy timestamp cursor changed");
Require(db.GetStats()["total_messages"] is long total && total == count + 2, "query modified records");
Console.WriteLine($"PASS: {count} monthly records across {pages} pages, tied timestamps, boundaries, bounded search, legacy cursor and unchanged totals");

namespace LinkFlow { internal static class AppLog { public static void Warn(string category, string message) => Console.Error.WriteLine(category + ": " + message); } }
