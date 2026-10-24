using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// A dedicated authorized_keys command, not the system-wide SSH shell.
public static class CompatShell {
    static string Posix(string path) {
        path = path.Replace('\\', '/');
        if (path.Length > 2 && path[1] == ':')
            return "/" + Char.ToLowerInvariant(path[0]) + path.Substring(2);
        return path;
    }
    static string Quote(string s) {
        var b = new StringBuilder("\""); int n = 0;
        foreach (char c in s) {
            if (c == '\\') { n++; continue; }
            if (c == '"') { b.Append('\\', n * 2 + 1); b.Append(c); n = 0; continue; }
            b.Append('\\', n); n = 0; b.Append(c);
        }
        b.Append('\\', n * 2); return b.Append('"').ToString();
    }
    public static int Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string command = Environment.GetEnvironmentVariable("SSH_ORIGINAL_COMMAND");
            if (String.IsNullOrWhiteSpace(command)) {
                Console.Error.WriteLine("This key requires an explicit SSH command."); return 64;
            }
            string bash = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Git", "bin", "bash.exe");
            var info = new ProcessStartInfo(bash, "--noprofile --norc -c " + Quote(command));
            info.UseShellExecute = false;
            info.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            info.EnvironmentVariables["CODEX_SSH_COMPAT_ROOT"] = Posix(root);
            info.EnvironmentVariables["BASH_ENV"] = Posix(Path.Combine(root, "env.sh"));
            info.EnvironmentVariables["SHELL"] = Posix(Path.Combine(root, "bin", "login-sh"));
            info.EnvironmentVariables["HOME"] = Posix(info.WorkingDirectory);
            // Inherit the binary stdin/stdout handles; do not transcode WebSocket bytes.
            using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
        } catch (Exception e) { Console.Error.WriteLine("SSH compatibility shell: " + e.Message); return 1; }
    }
}
