using System.Net;
using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

// Exercise the real upload handler and SQLite in a private temporary directory.
// No listener, application UI, clipboard, existing data or user files are used.
var assembly = args.Length == 0 ? Assembly.Load("LinkFlow") : Assembly.LoadFrom(Path.GetFullPath(args[0]));
Console.WriteLine($"Testing {assembly.Location} (version {assembly.GetName().Version})");
var pathsType = assembly.GetType("LinkFlow.AppPaths", true)!;
var serverType = assembly.GetType("LinkFlow.LinkFlowServer", true)!;
var dbType = assembly.GetType("LinkFlow.MessageDb", true)!;
var tempRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "linkflow-upload-tests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(Path.Combine(tempRoot, "data"));
try
{
    var paths = Activator.CreateInstance(pathsType, BindingFlags.Instance | BindingFlags.NonPublic,
        null, new object[] { tempRoot }, null)!;
    var dbPath = Path.Combine(tempRoot, "data", "messages.db");
    var database = Activator.CreateInstance(dbType, new object[] { dbPath })!;
    var server = Activator.CreateInstance(serverType, new object?[] { paths, null })!;
    serverType.GetField("_db", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(server, database);
    var upload = serverType.GetMethod("HandleUpload", BindingFlags.Instance | BindingFlags.NonPublic)!;
    var filesRoot = Path.Combine(tempRoot, "data", "files");

    void Sql(string text)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = dbPath, Pooling = false }.ToString());
        connection.Open();
        using var command = connection.CreateCommand(); command.CommandText = text; command.ExecuteNonQuery();
    }
    int CountRecords()
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = dbPath, Pooling = false }.ToString());
        connection.Open();
        using var command = connection.CreateCommand(); command.CommandText = "SELECT COUNT(*) FROM messages";
        return Convert.ToInt32(command.ExecuteScalar());
    }
    async Task<DefaultHttpContext> Send(string filename, string text, bool fail = false)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(text)), "file", filename);
        using var body = new MemoryStream(await form.ReadAsByteArrayAsync());
        using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Connection.RemoteIpAddress = IPAddress.Loopback;
        context.Request.Method = "POST";
        context.Request.ContentType = form.Headers.ContentType!.ToString();
        context.Request.Body = body;
        context.Response.Body = new MemoryStream();
        try
        {
            await (Task)upload.Invoke(server, new object[] { context })!;
            Check(!fail, "SQLite rejection must propagate; no success response");
        }
        catch (SqliteException) when (fail)
        {
            Check(context.Response.Body.Length == 0, "Rejected upload must not return success");
        }
        Check(Directory.GetFiles(Path.Combine(tempRoot, "data", ".uploads")).Length == 0, "No .part file remains");
        return context;
    }
    var first = await Send("fixture.txt", "original");
    Check(first.Response.StatusCode == 200 && CountRecords() == 1, "Successful upload registers exactly once");
    var existing = Directory.GetFiles(filesRoot, "*", SearchOption.AllDirectories).Single();
    Check(File.ReadAllText(existing) == "original", "Successful upload bytes preserved");
    Console.WriteLine("PASS: successful upload persists file and database record");

    Sql("CREATE TRIGGER reject_upload BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END");
    await Send("new-file.txt", "rejected new file", fail: true);
    Check(Directory.GetFiles(filesRoot, "*", SearchOption.AllDirectories).SequenceEqual(new[] { existing }), "Failed registration must roll back the moved file");
    Check(CountRecords() == 1, "Failed registration adds no record");
    Console.WriteLine("PASS: database failure removes the final file and temporary file");

    await Send("fixture.txt", "rejected collision", fail: true);
    Check(Directory.GetFiles(filesRoot, "*", SearchOption.AllDirectories).SequenceEqual(new[] { existing }), "Rollback removes only the new collision file");
    Check(File.ReadAllText(existing) == "original" && CountRecords() == 1, "Old file and message remain intact");
    Sql("DROP TRIGGER reject_upload");
    await Send("fixture.txt", "retried upload");
    Check(CountRecords() == 2 && Directory.GetFiles(filesRoot, "*", SearchOption.AllDirectories).Length == 2, "Retry creates exactly one new file and record");
    Check(File.ReadAllText(existing) == "original", "Retry retains original bytes");
    Console.WriteLine("PASS: same-name rollback and successful retry preserve old data");
}
finally
{
    // This path was created above, is absolute, and must remain inside the temp directory.
    var allowedRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (tempRoot.StartsWith(allowedRoot, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(tempRoot).StartsWith("linkflow-upload-tests-"))
        Directory.Delete(tempRoot, recursive: true);
}
static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
