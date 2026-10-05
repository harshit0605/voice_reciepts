# Sends a receipt (raw ESC/POS bytes) to a printer installed in Windows, such as a USB receipt
# printer, and waits until Windows has handed it to the printer. Run by the gateway:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File print-raw.ps1 -Printer "POS-80" -Path receipt.bin
#
# Exit code 0: the printer received the receipt. Otherwise the reason is the last line on stderr,
# and a job still in the queue is cancelled so it cannot come out later on top of a reprint.
# Works in Windows PowerShell 5.1.
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$WaitSeconds = 20
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class CounterwellRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string DocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr printer);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr printer, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);

  // Returns the Windows print job ID.
  public static int Send(string name, byte[] bytes) {
    IntPtr printer;
    if (!OpenPrinter(name, out printer, IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows has no printer called '" + name + "'");
    try {
      DocInfo info = new DocInfo();
      info.DocName = "Counterwell receipt";
      info.DataType = "RAW";
      int job = StartDocPrinter(printer, 1, info);
      if (job == 0)
        throw new Win32Exception(Marshal.GetLastWin32Error(), "The printer did not accept the receipt");
      try {
        if (!StartPagePrinter(printer))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "The printer did not accept the receipt");
        int written;
        bool sent = WritePrinter(printer, bytes, bytes.Length, out written);
        EndPagePrinter(printer);
        if (!sent || written != bytes.Length)
          throw new Win32Exception(Marshal.GetLastWin32Error(), "Only part of the receipt reached the print queue");
      } finally {
        EndDocPrinter(printer);
      }
      return job;
    } finally {
      ClosePrinter(printer);
    }
  }
}
'@

$bytes = [IO.File]::ReadAllBytes($Path)
try {
  $job = [CounterwellRawPrinter]::Send($Printer, $bytes)
} catch {
  $problem = $_.Exception
  while ($problem.InnerException) { $problem = $problem.InnerException }
  [Console]::Error.WriteLine($problem.Message)
  exit 2
}

# The job leaves the queue once Windows has sent it to the printer (or shows Printed/Complete when
# the printer keeps printed documents). An error, offline or out-of-paper state, or a job still
# waiting at the deadline, is reported and cancelled.
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$reason = ''
while ($true) {
  $state = Get-PrintJob -PrinterName $Printer -ID $job -ErrorAction SilentlyContinue
  if (-not $state) { exit 0 }
  $status = [string]$state.JobStatus
  if ($status -match 'Printed|Complete') { exit 0 }
  if ($status -match 'Error|Offline|PaperOut|Blocked|UserIntervention|Paused') {
    $reason = "The printer reports: $status"
    break
  }
  if ((Get-Date) -gt $deadline) {
    $reason = 'The receipt was still waiting in the Windows print queue'
    break
  }
  Start-Sleep -Milliseconds 300
}
Remove-PrintJob -PrinterName $Printer -ID $job -ErrorAction SilentlyContinue
[Console]::Error.WriteLine("$reason; it was cancelled.")
exit 1
