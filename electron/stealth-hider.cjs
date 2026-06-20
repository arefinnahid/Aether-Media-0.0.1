const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const stealthExePath = path.join(os.tmpdir(), 'aether-wh.exe');
let stealthExeReady = false;

/**
 * Compiles the C# stealth helper if it doesn't exist.
 * The helper polls for windows belonging to children of the parent process
 * and strips their taskbar icons.
 */
function initializeStealthHider() {
  if (process.platform !== 'win32') return;
  if (fs.existsSync(stealthExePath)) {
    stealthExeReady = true;
    return;
  }

  const csSrc = [
    'using System;',
    'using System.Text;',
    'using System.Diagnostics;',
    'using System.Runtime.InteropServices;',
    'using System.Threading;',
    'class P {',
    '  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr R1; public IntPtr Peb; public IntPtr R2_0; public IntPtr R2_1; public IntPtr UniqueId; public IntPtr ParentId; }',
    '  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, ref PBI i, int l, out int r);',
    '  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool b, uint d);',
    '  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
    '  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int n);',
    '  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int n, int v);',
    '  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lp, IntPtr lp2);',
    '  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder c, int m);',
    '  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr ha, int x, int y, int cx, int cy, uint f);',
    '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);',
    '  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);',
    '  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);',
    '  static uint GetPPid(uint pid) {',
    '    IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return 0;',
    '    PBI i = new PBI(); int r; int st = NtQueryInformationProcess(h, 0, ref i, Marshal.SizeOf(i), out r);',
    '    CloseHandle(h); return st == 0 ? (uint)i.ParentId : 0;',
    '  }',
    '  static void Main(string[] args) {',
    '    if (args.Length == 0) return; uint pPid = uint.Parse(args[0]);',
    '    while (true) {',
    '      try { Process.GetProcessById((int)pPid); } catch { return; }',
    '      EnumWindows((h, l) => {',
    '        uint pid; GetWindowThreadProcessId(h, out pid);',
    '        if (pid == 0 || pid == pPid) return true;',
    '        StringBuilder cn = new StringBuilder(32);',
    '        if (GetClassName(h, cn, cn.Capacity) > 0 && cn.ToString().Contains("Chrome_WidgetWin")) {',
    '          if (GetPPid(pid) == pPid) {',
    '            int s = GetWindowLong(h, -20);',
    '            if ((s & 0x80) == 0 || (s & 0x40000) != 0) {',
    '              ShowWindow(h, 0);',
    '              SetWindowPos(h, IntPtr.Zero, -32000, -32000, 0, 0, 0x0001 | 0x0004 | 0x0010);',
    '              SetWindowLong(h, -20, (s & ~0x40000) | 0x80);',
    '            }',
    '          }',
    '        }',
    '        return true;',
    '      }, IntPtr.Zero);',
    '      Thread.Sleep(5);',
    '    }',
    '  }',
    '}'
  ].join('\n');

  const srcPath = stealthExePath.replace('.exe', '.cs');
  try {
    fs.writeFileSync(srcPath, csSrc);
    const cscPaths = [
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
    ];
    const cscPath = cscPaths.find(p => fs.existsSync(p));
    if (cscPath) {
      execFile(
        cscPath,
        ['/nologo', '/optimize', '/out:' + stealthExePath, srcPath],
        { windowsHide: true },
        (err) => {
          if (!err) {
            stealthExeReady = true;
            startStealthHider(); // Start immediately when ready
          }
          try { fs.unlinkSync(srcPath); } catch { }
        }
      );
    }
  } catch (e) {
    console.error('[STEALTH] Failed to compile helper:', e.message);
  }
}

let hiderProcess = null;

/**
 * Starts the stealth hider for the current process (singleton).
 */
function startStealthHider() {
  if (process.platform !== 'win32') return;
  if (!stealthExeReady) return;
  if (hiderProcess) return; // Already running

  hiderProcess = execFile(stealthExePath, [process.pid.toString()], { windowsHide: true });
  console.log('[STEALTH] Persistent hider started (PID: ' + hiderProcess.pid + ')');

  hiderProcess.on('exit', () => {
    hiderProcess = null;
    console.log('[STEALTH] Hider process exited');
  });
}

// Auto-initialize on module load
initializeStealthHider();

module.exports = {
  startStealthHider
};
