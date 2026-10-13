using System.Reflection;

// Android UI fixture: real server, copied static UI and isolated empty data.
// Stop by writing 'stop' to stdin. Never opens a desktop window or uses project data/.
var assembly = Assembly.Load("LinkFlow");
var pathsType = assembly.GetType("LinkFlow.AppPaths", true)!;
var serverType = assembly.GetType("LinkFlow.LinkFlowServer", true)!;
var fixture = Path.GetFullPath(args[0]);
var source = Path.GetFullPath(args[1]);
Directory.CreateDirectory(Path.Combine(fixture, "static"));
Directory.CreateDirectory(Path.Combine(fixture, "data"));
foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories)) {
    var target = Path.Combine(fixture, "static", Path.GetRelativePath(source, file));
    Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(file, target, true);
}
File.WriteAllText(Path.Combine(fixture, "data", "config.json"), "{\"pairing_token\":\"test-pairing-token-0123456789abcdef\"}");
var paths = Activator.CreateInstance(pathsType, BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { fixture }, null)!;
var server = Activator.CreateInstance(serverType, new object?[] { paths, null })!;
try {
    await (Task)serverType.GetMethod("StartAsync")!.Invoke(server, null)!;
    // Emulator traffic arrives on host loopback; still exercise phone authentication.
    ((HashSet<string>)serverType.GetField("_localIps", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(server)!).Clear();
    int port = (int)serverType.GetProperty("Port")!.GetValue(server)!;
    File.WriteAllText(Path.Combine(fixture, "port.txt"), port.ToString());
    Console.WriteLine($"STARTUP FIXTURE READY {port}");
    while (Console.ReadLine() is string command && command != "stop") {
        if (command == "clients" || command == "clients-wait") {
            var clients = serverType.GetField("_clients", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(server)!;
            if (command == "clients-wait") {
                // Bounded local test observation, not phone/network availability polling.
                var watch = System.Diagnostics.Stopwatch.StartNew();
                while ((int)clients.GetType().GetProperty("Count")!.GetValue(clients)! == 0 && watch.ElapsedMilliseconds < 8000)
                    await Task.Delay(25);
            }
            Console.WriteLine("CLIENTS " + clients.GetType().GetProperty("Count")!.GetValue(clients));
        }
        if (command == "announce") {
            var discovery = serverType.GetField("_discovery", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(server)!;
            discovery.GetType().GetMethod("AnnounceTo")!.Invoke(discovery, new object[] { new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 15839) });
            Console.WriteLine("STARTUP EVENT SENT");
        }
    }
} finally { await (Task)serverType.GetMethod("StopAsync")!.Invoke(server, null)!; }
