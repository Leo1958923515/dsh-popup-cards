/**
 * dsh-popup-cards —— DeepSeek Harness 的桌面弹窗提醒插件。
 *
 * 三种会把控制权交回给你的时刻各弹一张置顶卡片（Windows / WPF / PowerShell）：
 *
 *   1. 需要权限  —— 工具请求审批（`approval/request`）
 *   2. 需要选择  —— 模型提问（`ask_user_question`）或提交计划待审阅（`exit_plan_mode`）
 *   3. 任务完成  —— 一个根 agent 从 running 落到 idle（`agent/status`）
 *
 * 卡片样式对齐 DSH 客户端深色主题：`#2C2C2E` 底、`#1FFFFFFF` 描边、12px 圆角、
 * 主文字 `#F9FAFB`、次文字 `#ADB2B8`，固定在主屏工作区右下角。正文只有三行：
 * 任务名称（会话标题）、待确认类型、以及一行关闭提示小字。
 *
 * 与常见的 toast 通知不同，卡片默认不自动消失：点卡片任意处（切回 DSH 并关闭）、
 * 点右上角 ×（只关闭），或者你自己切回 DSH 时它自行关闭。卡片跑在独立进程里，
 * 不阻塞 agent 回合；同一时刻只显示一张，后面的排队，关掉当前这张再弹下一张。
 *
 * 默认只在“驱动这个会话的客户端”不在前台时弹：你正盯着 DSH 时，应用内已经有
 * 审批/提问提示，再弹一张卡片只是重复打扰；从 Obsidian 之类的外部客户端发起的
 * 会话同理——那个客户端在前台时不弹。客户端归属在每条消息发出时记录一次（根
 * agent 的 `agent/status` 进入 running），只记前台进程名，不碰客户端内部状态。
 * 判断失败时按“该弹”处理，宁可多弹也不漏提醒。
 *
 * 只依赖 Node 内置模块，没有任何 npm 依赖、没有预编译二进制、没有构建步骤。
 *
 * @module dsh-popup-cards
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

/** 插件名（Loader 用它做日志与条目标识）。 */
export const name = 'dsh-popup-cards'

/** 本插件只用 Cordis 事件，不注入任何服务。 */
export const inject = []

/**
 * 待确认类型的展示文案。卡片第二行只显示这里的值。
 * @type {Record<string, string>}
 */
export const KIND_LABELS = {
  approval: '权限确认',
  question: '提问待答',
  planReview: '计划确认',
  complete: '任务完成',
  selfTest: '插件自检',
}

/** 可被 patch 覆盖的默认值。 */
export const DEFAULT_CONFIG = {
  /** 自检卡片的任务名（正常提醒用会话标题）。 */
  title: 'DeepSeek Harness',

  /** 是否在审批请求时提醒。 */
  notifyOnApproval: true,
  /** 是否在提问 / 计划审阅时提醒。 */
  notifyOnQuestion: true,
  /** 是否在一次运行结束时提醒。 */
  notifyOnComplete: true,

  /**
   * 子 agent 的提醒是否静音。默认 true：后台委派、workflow worker 等的完成不该
   * 打断你。
   */
  ignoreSubagents: true,

  /**
   * DSH 在前台（你正在应用里操作）时不弹卡片：应用内已有审批/提问提示，弹出来
   * 只是重复打扰。关掉这个开关就恢复“任何情况都弹”。
   */
  skipWhenDSHFocused: true,

  /**
   * 前台窗口标题里出现这段文字就认为 DSH 在前台。桌面窗口标题形如
   * `会话名 — DeepSeek Harness`；DSH 开在浏览器标签页时标题尾部还会带浏览器名，
   * 所以用“包含”匹配而不是“等于”。留空则只认完全等于 `DeepSeek Harness`。
   */
  dshWindowTitleMarker: '— DeepSeek Harness',

  /**
   * 客户端归属（L2）：每次你发出消息、根 agent 进入 running 时，记下此时前台窗口
   * 的进程名，和这个会话绑定。之后这个会话的提醒，在那个客户端位于前台时不弹。
   * 关掉它就退回纯标题判断（只认 DSH 桌面窗口）。
   */
  attributeByClient: true,

  /**
   * 参与归属的客户端进程名，例如 Obsidian 填 `'Obsidian.exe'`。大小写不敏感。
   * DSH 自己（`DeepSeek Harness.exe`）始终按前台抑制处理，不需要填在这里。
   */
  clientProcesses: [],

  /** 点击卡片时，先把 DSH 主窗口切到前台（最小化则还原），再关掉卡片。 */
  activateDSHOnClick: true,

  /** 你自己切回 DSH（没点卡片）时，卡片自动关闭。 */
  autoCloseOnDSHFocus: true,

  /** 自动关闭的前台检测间隔（毫秒），会被夹到 100–2000；越小越跟手。 */
  foregroundPollMs: 400,

  /** 弹窗时播放系统提示音。 */
  sound: false,

  /**
   * 卡片自动关闭的毫秒数；0 表示常驻，点卡片任意处才关。
   * 要 toast 式自动消失就填一个正数，例如 8000。
   */
  durationMs: 0,

  /** 卡片底部的关闭提示小字；留空则不显示这一行。 */
  hintText: '点击回到 DSH',

  /** 同一会话两次完成提醒的最小间隔（毫秒），避免密集交互时反复弹。 */
  completeCooldownMs: 10000,

  /** 挂载时立刻弹一次，用来确认 PowerShell 通路可用。 */
  testOnStart: false,

  /** 诊断日志文件路径；留空表示不写。排查“到底有没有触发”时用。 */
  traceFile: '',
}

/**
 * 会把控制权交给用户的工具：模型调它们时就是在等你做选择。
 * `ask_user_question` 是通用提问，`exit_plan_mode` 是计划审阅。
 */
const ASKING_TOOLS = new Map([
  ['ask_user_question', KIND_LABELS.question],
  ['exit_plan_mode', KIND_LABELS.planReview],
])

/**
 * 把文本包成 PowerShell 单引号字符串字面量（内部单引号翻倍转义）。
 * @param {unknown} text 任意文本。
 * @returns {string} 可内联进 PowerShell 的字面量。
 */
function psLiteral(text) {
  return `'${String(text ?? '').replace(/'/g, "''")}'`
}

/** DSH 桌面客户端的进程名（卡片进程据此判断“你正看着 DSH”）。 */
export const DSH_PROCESS = 'DeepSeek Harness.exe'

/**
 * 归一化 `clientProcesses`：接受数组或单个字符串，去掉空白与重复项。
 * @param {unknown} value 配置值。
 * @returns {string[]} 进程名列表（保留大小写，比较时忽略）。
 */
export function clientProcessesOf(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const seen = new Set()
  const result = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (name.length === 0) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

/**
 * 某个前台进程是否属于“会驱动会话的客户端”（DSH 桌面端或配置的客户端）。
 * @param {string} exe 前台进程名，如 `Obsidian.exe`。
 * @param {string[]} clientProcesses 配置的客户端进程名。
 * @returns {boolean} true 表示可以把它记录成会话归属。
 */
export function isClientProcess(exe, clientProcesses) {
  if (typeof exe !== 'string' || exe.length === 0) return false
  const target = exe.toLowerCase()
  if (target === DSH_PROCESS.toLowerCase()) return true
  return clientProcessesOf(clientProcesses).some((item) => item.toLowerCase() === target)
}

/**
 * 探测前台进程的 PowerShell 脚本：一次调用只返回一行进程名。
 * 用 `Get-Process` 取名（进程可能已退出/无权限，拿不到就返回空串）。
 * @returns {string} 单行 PowerShell 脚本。
 */
export function buildProbeScript() {
  return [
    '$ErrorActionPreference = "Stop"',
    '$sig = @\'',
    'public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
    '\'@',
    '$probe = Add-Type -MemberDefinition $sig -Name DshPopupProbe -Namespace DshPopupNotify -PassThru',
    '$h = [DshPopupNotify.DshPopupProbe]::GetForegroundWindow()',
    'if ($h -eq [IntPtr]::Zero) { return }',
    '[uint32]$procId = 0',
    '[void][DshPopupNotify.DshPopupProbe]::GetWindowThreadProcessId($h, [ref]$procId)',
    'try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName + ".exe" } catch { }',
  ].join('\n')
}

/**
 * 异步读一次前台进程名；拿不到（超时、无权限、非 Windows）就回调空串。
 * 探测进程隐藏启动、不抢焦点，200–500 ms 内返回。
 * @param {(exe: string) => void} callback 结果回调。
 * @returns {void}
 */
export function foregroundProcessName(callback) {
  if (process.platform !== 'win32') {
    callback('')
    return
  }
  let child
  let settled = false
  const finish = (value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    callback(value)
  }
  const timer = setTimeout(() => {
    try {
      child?.kill()
    } catch {
      // 进程已退出时忽略。
    }
    finish('')
  }, 1500)
  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', buildProbeScript()],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    )
  } catch {
    finish('')
    return
  }
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  child.once('error', () => finish(''))
  child.once('exit', () => finish(output.trim().split(/\r?\n/).pop() ?? ''))
  child.unref()
}

/**
 * 卡片进程内用到的 Win32 辅助类（通过 `Add-Type -MemberDefinition` 编译）。
 *
 * 一个类型同时提供三件事：读前台窗口标题（前台抑制/自动关闭）、按标题找 DSH
 * 窗口、把窗口切到前台。全部在卡片进程里完成，不额外起进程。
 */
const WIN32_HELPER = `public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
private static string needle = "";
private static IntPtr found = IntPtr.Zero;
private static bool Match(IntPtr hWnd, IntPtr lParam) {
  if (!IsWindowVisible(hWnd)) return true;
  var sb = new System.Text.StringBuilder(512);
  GetWindowText(hWnd, sb, 512);
  string t = sb.ToString();
  if (t.Length == 0) return true;
  if (needle.Length == 0 ? t == "DeepSeek Harness" : (t == needle || t.Contains(needle))) { found = hWnd; return false; }
  return true;
}
public static IntPtr FindByTitle(string marker) {
  needle = marker ?? "";
  found = IntPtr.Zero;
  EnumWindows(new EnumWindowsProc(Match), IntPtr.Zero);
  return found;
}
public static string ForegroundTitle() {
  var sb = new System.Text.StringBuilder(512);
  GetWindowText(GetForegroundWindow(), sb, 512);
  return sb.ToString();
}
public static bool Activate(IntPtr hWnd) {
  if (hWnd == IntPtr.Zero) return false;
  if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
  if (SetForegroundWindow(hWnd) && GetForegroundWindow() == hWnd) return true;
  keybd_event(0x12, 0, 0, UIntPtr.Zero);
  keybd_event(0x12, 0, 2, UIntPtr.Zero);
  if (SetForegroundWindow(hWnd) && GetForegroundWindow() == hWnd) return true;
  SwitchToThisWindow(hWnd, true);
  if (GetForegroundWindow() == hWnd) return true;
  uint fgPid;
  uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
  uint myThread = GetCurrentThreadId();
  bool attached = fgThread != 0 && AttachThreadInput(myThread, fgThread, true);
  try {
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
  } finally {
    if (attached) AttachThreadInput(myThread, fgThread, false);
  }
  return GetForegroundWindow() == hWnd;
}
private static string needleProcess = "";
private static IntPtr foundProcess = IntPtr.Zero;
private static string ProcessNameOf(uint pid) {
  try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch { return ""; }
}
public static string ForegroundProcessName() {
  IntPtr h = GetForegroundWindow();
  if (h == IntPtr.Zero) return "";
  uint pid;
  GetWindowThreadProcessId(h, out pid);
  return ProcessNameOf(pid);
}
private static bool MatchProcess(IntPtr hWnd, IntPtr lParam) {
  if (!IsWindowVisible(hWnd)) return true;
  uint pid;
  GetWindowThreadProcessId(hWnd, out pid);
  if (System.String.Compare(ProcessNameOf(pid), needleProcess, System.StringComparison.OrdinalIgnoreCase) == 0) { foundProcess = hWnd; return false; }
  return true;
}
public static IntPtr FindByProcessName(string processName) {
  needleProcess = processName ?? "";
  foundProcess = IntPtr.Zero;
  if (needleProcess.Length == 0) return IntPtr.Zero;
  EnumWindows(new EnumWindowsProc(MatchProcess), IntPtr.Zero);
  return foundProcess;
}`

/** 与 DSH 主题对齐的卡片 XAML：深色圆角面板 + 三行文字 + 右上角关闭按钮。 */
const CARD_XAML = `<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ShowInTaskbar="False" Topmost="True" ShowActivated="False"
        ResizeMode="NoResize" SizeToContent="WidthAndHeight"
        WindowStartupLocation="Manual" Opacity="0" UseLayoutRounding="True">
  <Grid Margin="12">
    <Border Background="#2C2C2E" CornerRadius="12" BorderBrush="#1FFFFFFF" BorderThickness="1"
            Padding="16,12" MinWidth="220" MaxWidth="360" SnapsToDevicePixels="True">
      <Border.Effect>
        <DropShadowEffect BlurRadius="20" ShadowDepth="4" Opacity="0.35" Color="#000000"/>
      </Border.Effect>
      <Grid>
        <StackPanel>
          <TextBlock x:Name="TaskText" TextAlignment="Left" FontFamily="Microsoft YaHei UI" FontSize="14" FontWeight="SemiBold"
                     Foreground="#F9FAFB" TextWrapping="NoWrap" TextTrimming="CharacterEllipsis" Margin="0,0,16,0"/>
          <TextBlock x:Name="KindText" TextAlignment="Left" FontFamily="Microsoft YaHei UI" FontSize="12"
                     Foreground="#ADB2B8" Margin="0,6,0,0" TextWrapping="NoWrap" TextTrimming="CharacterEllipsis"/>
          <TextBlock x:Name="HintText" TextAlignment="Left" FontFamily="Microsoft YaHei UI" FontSize="11"
                     Foreground="#8EADB2B8" Margin="0,6,0,0" TextWrapping="NoWrap" TextTrimming="CharacterEllipsis"/>
        </StackPanel>
        <Border x:Name="CloseButton" HorizontalAlignment="Right" VerticalAlignment="Top"
                Margin="0,-6,-8,0" Padding="6,2,6,2" Background="Transparent" Cursor="Hand"
                ToolTip="关闭">
          <TextBlock x:Name="CloseText" FontFamily="Microsoft YaHei UI" FontSize="14"
                     Foreground="#8EADB2B8" Text="×"/>
        </Border>
      </Grid>
    </Border>
  </Grid>
</Window>`

/**
 * 组装弹出的 PowerShell 脚本：一张右下的 WPF 卡片，三行文字，常驻或定时关闭。
 *
 * 任务名/类型/提示都用单引号字面量携带，`$`、反引号、双引号都是普通字符；换行由
 * 字面量里的真实换行表示。窗口在 Loaded 里贴到主屏工作区右下角（24px 间距），
 * 窗口整体透明，阴影靠 12px 内边距留白。
 *
 * @param {string} task 任务名称（会话标题）。
 * @param {string} kind 待确认类型。
 * @param {{ sound?: boolean, durationMs?: number, hintText?: string, skipWhenDSHFocused?: boolean, dshWindowTitleMarker?: string, activateDSHOnClick?: boolean, autoCloseOnDSHFocus?: boolean, foregroundPollMs?: number, traceFile?: string, clientExe?: string, dshProcess?: string }} options
 *   声音、自动关闭时长、关闭提示、前台抑制、点击回 DSH、切回自动关闭、检测间隔、诊断日志路径，
 *   以及本会话的客户端进程名（`clientExe`）与 DSH 进程名（`dshProcess`）。
 * @returns {string} 单条 PowerShell 脚本（换行分隔）。
 */
export function buildScript(task, kind, options) {
  const rawDuration = Number(options?.durationMs)
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : 0
  const hint = typeof options?.hintText === 'string' ? options.hintText : ''
  const tracePath = typeof options?.traceFile === 'string' ? options.traceFile : ''
  const marker = typeof options?.dshWindowTitleMarker === 'string'
    ? options.dshWindowTitleMarker
    : DEFAULT_CONFIG.dshWindowTitleMarker
  const markerLiteral = psLiteral(marker)
  const markerCheck = marker.length > 0 ? ` -or $fgText.Contains(${markerLiteral})` : ''
  const clientExe = typeof options?.clientExe === 'string' ? options.clientExe : ''
  const dshExe = typeof options?.dshProcess === 'string' && options.dshProcess.length > 0
    ? options.dshProcess
    : DSH_PROCESS
  const clientLiteral = psLiteral(clientExe)
  const dshLiteral = psLiteral(dshExe)
  const skipWhenFocused = options?.skipWhenDSHFocused !== false
  const activateOnClick = options?.activateDSHOnClick !== false
  const autoClose = options?.autoCloseOnDSHFocus !== false
  const rawPoll = Number(options?.foregroundPollMs)
  const pollMs = Number.isFinite(rawPoll) ? Math.min(2000, Math.max(100, Math.round(rawPoll))) : DEFAULT_CONFIG.foregroundPollMs
  const needsWin32 = skipWhenFocused || activateOnClick || autoClose

  const lines = [
    '$ErrorActionPreference = "Stop"',
    `$tracePath = ${psLiteral(tracePath)}`,
    `$clientExe = ${clientLiteral}`,
    `$dshExe = ${dshLiteral}`,
    `$poll = $null`,
    'function Write-DshTrace([string]$Message) {',
    '  if ($tracePath.Length -eq 0) { return }',
    '  try { [System.IO.File]::AppendAllText($tracePath, "$(Get-Date -Format o) $Message`n") } catch { }',
    '}',
  ]

  // Win32 辅助类：读前台标题、按标题找窗口、把窗口切到前台。编译失败就整体降级
  // （不判断、不自动关、点击只关闭），卡片本身照常显示。
  if (needsWin32) {
    lines.push(
      `try {`,
      `  $winType = @(Add-Type -MemberDefinition ${psLiteral(WIN32_HELPER)} -Name DshPopupWin -Namespace DshPopupNotify -PassThru) | Select-Object -Last 1`,
      `} catch { $winType = $null }`,
    )
  } else {
    lines.push('$winType = $null')
  }
  if (tracePath) {
    lines.push('if ($null -ne $winType) { Write-DshTrace "winapi: compiled" } else { Write-DshTrace "winapi: compile failed" }')
  }

  // 前台抑制：DSH 窗口正被操作时直接退出，不建窗口。放在加载 WPF 之前，被抑制
  // 时只花一次 Add-Type 编译的时间。任何异常都吞掉继续往下走（fail-open）。
  if (skipWhenFocused) {
    lines.push(
      'if ($null -ne $winType) {',
      '  try {',
      '    $fgExe = [DshPopupNotify.DshPopupWin]::ForegroundProcessName()',
      '    $fgText = [DshPopupNotify.DshPopupWin]::ForegroundTitle()',
      `    if ($fgExe -eq $dshExe -or $fgText -eq 'DeepSeek Harness'${markerCheck} -or ($clientExe.Length -gt 0 -and $fgExe -eq $clientExe)) {`,
      '      Write-DshTrace "skip: client foreground exe=$fgExe title=$fgText"',
      '      exit 0',
      '    }',
      '  } catch { }',
      '}',
    )
  }

  lines.push(
    'Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase',
    `$dpi = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -Name DshPopupDpi -Namespace DshPopupNotify -PassThru`,
    '[void]$dpi::SetProcessDPIAware()',
    `[xml]$xaml = @'`,
    CARD_XAML,
    `'@`,
    '$reader = New-Object System.Xml.XmlNodeReader $xaml',
    '$window = [System.Windows.Markup.XamlReader]::Load($reader)',
    `$window.FindName('TaskText').Text = ${psLiteral(task)}`,
    `$window.FindName('KindText').Text = ${psLiteral(kind)}`,
    `$hint = $window.FindName('HintText')`,
    `$hint.Text = ${psLiteral(hint)}`,
    `if ($hint.Text.Length -eq 0) { $hint.Visibility = [System.Windows.Visibility]::Collapsed }`,
  )
  if (tracePath) lines.push('Write-DshTrace "card: xaml loaded"')

  // 切回自动关闭：卡片期间每 pollMs 看一次前台标题，变回 DSH 就自己关。
  if (autoClose) {
    lines.push(
      '$poll = New-Object System.Windows.Threading.DispatcherTimer',
      `$poll.Interval = [TimeSpan]::FromMilliseconds(${pollMs})`,
      '$poll.Add_Tick({',
      '  if ($null -eq $winType) { return }',
      '  try {',
      '    $fgExe = [DshPopupNotify.DshPopupWin]::ForegroundProcessName()',
      '    $fgText = [DshPopupNotify.DshPopupWin]::ForegroundTitle()',
      `    if ($fgExe -eq $dshExe -or $fgText -eq 'DeepSeek Harness'${markerCheck} -or ($clientExe.Length -gt 0 -and $fgExe -eq $clientExe)) {`,
      '      Write-DshTrace "auto-close: client foreground exe=$fgExe title=$fgText"',
      '      $poll.Stop()',
      '      $window.Close()',
      '    }',
      '  } catch { Write-DshTrace "poll: error $_" }',
      '})',
    )
  }

  lines.push(
    '$window.Add_Loaded({',
    '  $area = [System.Windows.SystemParameters]::WorkArea',
    '  $gap = 24',
    '  $pad = 12',
    '  $window.Left = [Math]::Round($area.Right - $gap - $window.ActualWidth + $pad)',
    '  $window.Top = [Math]::Round($area.Bottom - $gap - $window.ActualHeight + $pad)',
    '  $fade = New-Object System.Windows.Media.Animation.DoubleAnimation 0, 1, ([System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(160)))',
    '  $window.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)',
  )
  if (autoClose) lines.push('  $poll.Start()', '  Write-DshTrace "card: poll started"')
  lines.push('})')

  // 点击：先停轮询 → 命中右上角 × 就只关卡片 → 否则把 DSH 切到前台（best-effort）
  // 再关闭。先激活再关，是因为「用户刚点了卡片」这一下才让我们有资格调用
  // SetForegroundWindow。
  lines.push(
    '$window.Add_MouseLeftButtonDown({',
    '  param($sender, $e)',
    '  try { if ($null -ne $poll) { $poll.Stop() } } catch { }',
    '  $hit = $null',
    '  try { $hit = $e.OriginalSource } catch { }',
    '  if ($null -ne $hit -and ($hit.Name -eq "CloseText" -or $hit.Name -eq "CloseButton")) {',
    '    Write-DshTrace "click: close button"',
    '    $window.Close()',
    '    return',
    '  }',
  )
  if (activateOnClick) {
    lines.push(
      '  if ($null -ne $winType) {',
      '    try {',
      '      $h = [IntPtr]::Zero',
      '      if ($clientExe.Length -gt 0) { $h = [DshPopupNotify.DshPopupWin]::FindByProcessName($clientExe) }',
      `      if ($h -eq [IntPtr]::Zero) { $h = [DshPopupNotify.DshPopupWin]::FindByTitle(${markerLiteral}) }`,
      '      if ($h -ne [IntPtr]::Zero) {',
      '        $ok = [DshPopupNotify.DshPopupWin]::Activate($h)',
      '        Write-DshTrace "click: activate hwnd=$h ok=$ok"',
      '      } else { Write-DshTrace "click: window not found" }',
      '    } catch { Write-DshTrace "click: activate failed: $_" }',
      '  }',
    )
  }
  lines.push('  $window.Close()', '})')

  if (options?.sound) {
    lines.push('try { [System.Media.SystemSounds]::Asterisk.Play() } catch {}')
  }
  if (duration > 0) {
    lines.push(
      '$timer = New-Object System.Windows.Threading.DispatcherTimer',
      `$timer.Interval = [TimeSpan]::FromMilliseconds(${duration})`,
      '$timer.Add_Tick({ $timer.Stop(); try { if ($null -ne $poll) { $poll.Stop() } } catch { }; $window.Close() })',
      '$timer.Start()',
    )
  }
  if (tracePath) lines.push('Write-DshTrace "card: showing"')
  lines.push('try { [void]$window.ShowDialog() } catch { Write-DshTrace "card: show failed $_" }')
  return lines.join('\n')
}

/**
 * 启动一个显示卡片的 PowerShell 进程。
 *
 * 脚本（含任务名/类型/提示）经 `-EncodedCommand` 以 UTF-16LE base64 传递：不经过
 * argv 的引号转义与控制台代码页转换，多行与任意引号都能原样到达。
 *
 * 进程**不能** detached：实测 detach 出去的 PowerShell 没有可交互窗口站，窗口
 * 会立刻返回、看不见。`unref` 只把子进程从事件循环引用计数里摘掉，宿主退出不受阻。
 *
 * @param {string} task 任务名称。
 * @param {string} kind 待确认类型。
 * @param {typeof DEFAULT_CONFIG} config 生效配置。
 * @returns {import('node:child_process').ChildProcess} 已启动的子进程。
 */
export function spawnDialog(task, kind, config) {
  const encoded = Buffer.from(buildScript(task, kind, config), 'utf16le').toString('base64')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { stdio: 'ignore', windowsHide: true },
  )
  child.unref()
  return child
}

/**
 * 读取会话工作目录的目录名，用作会话标题缺席时的兜底任务名。
 * @param {any} session 会话对象（可能不存在）。
 * @returns {string} 目录名；拿不到时为空串。
 */
function projectOf(session) {
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  // 会话可能在 Windows 上创建、在 POSIX 上读取（或反过来），这里只按路径分隔符切分，
  // 不依赖 node:path 的宿主平台语义，否则 Linux 上会把 'D:\work\proj' 整串当成名字。
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
  // 只有盘符（如 'C:'）时视作拿不到目录名，继续走会话 id 兜底。
  return /^[A-Za-z]:$/.test(name) ? '' : name
}

/**
 * 取卡片第一行的任务名称：会话标题 → 工作目录名 → 会话 id 前 8 位 → 默认文案。
 * @param {any} ctx Cordis 上下文（用来读 sessionTitle 服务）。
 * @param {any} session 会话对象（可能不存在）。
 * @returns {string} 非空的任务名称。
 */
export function taskNameOf(ctx, session) {
  try {
    const title = ctx?.get?.('sessionTitle')?.get?.(session)?.title
    if (typeof title === 'string' && title.trim().length > 0) return title.trim()
  } catch {
    // 标题服务不可用（未挂载/会话还没标题）时继续走兜底，不打断提醒。
  }
  const project = projectOf(session)
  if (project.length > 0) return project
  const id = typeof session?.id === 'string' ? session.id : ''
  return id.length >= 8 ? id.slice(0, 8) : 'DSH 任务'
}

/**
 * 是否为需要提醒的根 agent：子 agent、后台委派默认静音。
 * @param {any} agent 候选 agent。
 * @param {boolean} ignoreSubagents 是否静音子 agent。
 * @returns {boolean} true 表示该 agent 的提醒应当弹出。
 */
export function shouldNotify(agent, ignoreSubagents) {
  if (!ignoreSubagents) return true
  const header = agent?.session?.header
  if (header?.origin === 'subagent') return false
  if (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0) return false
  return true
}

/**
 * 插件主体：注册三个事件监听并维护一个弹窗队列。
 *
 * @param {any} ctx Cordis 上下文。
 * @param {Partial<typeof DEFAULT_CONFIG> | undefined} rawConfig patch 行里的 config。
 * @param {{ spawnDialog?: typeof spawnDialog, foregroundProcessName?: typeof foregroundProcessName }} [deps] 测试替身；生产调用从不传它。
 * @returns {void}
 */
export function apply(ctx, rawConfig, deps = {}) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig ?? {}) }
  const show = deps.spawnDialog ?? spawnDialog
  const probeForeground = deps.foregroundProcessName ?? foregroundProcessName

  /** 会话 id → 发起会话时所在客户端的进程名；超上限按插入顺序淘汰。 */
  const attributions = new Map()
  const ATTRIBUTION_LIMIT = 200

  let disposed = false
  /** 是否已有一张卡片在场（同一时刻只该有一个窗口）。 */
  let showing = false
  /** 排队中的提醒；Map 保序，同键只保留最新内容。 */
  const pending = new Map()
  /** 每个会话上一次完成提醒的时间戳，用于 completeCooldownMs。 */
  const lastCompleteAt = new Map()
  /** 每个 agent 上一次观察到的状态；只有 running→idle 才算“任务完成”。 */
  const lastStatus = new Map()

  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`${name}: ${message}`)
    } catch {
      // 日志服务不可用时静默：提醒功能本身不该因为日志失败而中断。
    }
  }

  /** 诊断追踪：traceFile 为空时是 no-op，写失败也绝不影响提醒。 */
  const trace = (message) => {
    if (typeof config.traceFile !== 'string' || config.traceFile.length === 0) return
    try {
      appendFileSync(config.traceFile, `${new Date().toISOString()} ${message}\n`)
    } catch {
      // 追踪只是诊断，磁盘不可写时静默放弃。
    }
  }

  trace(`apply: loaded (platform=${process.platform})`)

  ctx.effect(() => () => {
    // 卸载只停止后续排队；已经弹出的卡片留给用户自己关。
    disposed = true
    pending.clear()
    lastCompleteAt.clear()
    lastStatus.clear()
    attributions.clear()
    trace('apply: disposed')
  })

  /**
   * 记录一次会话的客户端归属：你在哪个客户端里发出这条消息，就记住它。
   *
   * 只在根 agent 从非 running 进入 running 的瞬间采样（= 你刚提交了消息），
   * 所以自动续跑、定时任务不会把归属改成“当前恰好在前台的那个软件”。
   * 采样结果不属于任何客户端时保持原值，避免你在等待期间切窗口导致误判。
   * @param {any} agent 状态变化的 agent。
   * @returns {void}
   */
  function captureAttribution(agent) {
    if (config.attributeByClient === false) return
    const clients = clientProcessesOf(config.clientProcesses)
    if (clients.length === 0) return
    const sessionId = typeof agent?.session?.id === 'string' ? agent.session.id : ''
    if (sessionId.length === 0) return
    const header = agent?.session?.header
    if (header?.origin === 'subagent') return
    if (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0) return
    probeForeground((exe) => {
      if (disposed || !isClientProcess(exe, clients)) return
      if (exe.toLowerCase() === DSH_PROCESS.toLowerCase()) return
      attributions.set(sessionId, exe)
      if (attributions.size > ATTRIBUTION_LIMIT) {
        const oldest = attributions.keys().next().value
        if (oldest !== undefined) attributions.delete(oldest)
      }
      trace(`attribution: session=${sessionId} client=${exe}`)
    })
  }

  /** 弹队列头部的一条提醒；该进程退出后再继续下一个。 */
  function drain() {
    if (disposed) {
      showing = false
      pending.clear()
      return
    }
    const head = pending.values().next()
    if (head.done) {
      showing = false
      return
    }
    const notice = head.value
    pending.delete(notice.key)
    showing = true

    if (process.platform !== 'win32') {
      warn('desktop popups are Windows-only; notification skipped')
      showing = false
      queueMicrotask(drain)
      return
    }

    let child
    try {
      // 前台抑制与自动关闭只对真实提醒生效；自检（force）永远弹、也不会被切回
      // DSH 立刻关掉，方便你确认样式。clientExe 是本会话的归属客户端（可能为空，
      // 为空时只按 DSH 前台判断）。
      const clientExe = notice.sessionId.length > 0 ? attributions.get(notice.sessionId) ?? '' : ''
      child = show(notice.task, notice.kind, {
        ...config,
        clientExe,
        dshProcess: DSH_PROCESS,
        skipWhenDSHFocused: config.skipWhenDSHFocused !== false && notice.force !== true,
        autoCloseOnDSHFocus: config.autoCloseOnDSHFocus !== false && notice.force !== true,
      })
    } catch (error) {
      warn(`failed to spawn powershell: ${String(error)}`)
      trace(`spawn threw: ${String(error)}`)
      showing = false
      queueMicrotask(drain)
      return
    }
    trace(`spawned card pid=${child.pid} key=${notice.key} task=${notice.task} kind=${notice.kind}`)
    child.once('error', (error) => {
      warn(`powershell failed: ${String(error)}`)
      trace(`child error: ${String(error)}`)
      showing = false
      queueMicrotask(drain)
    })
    child.once('exit', (code) => {
      trace(`card closed pid=${child.pid} code=${code}`)
      showing = false
      queueMicrotask(drain)
    })
  }

  /**
   * 排入一条提醒。
   * @param {string} key 去重键；同键重复提醒只保留最新内容。
   * @param {any} session 来源会话，用于取任务名称。
   * @param {string} kind 第二行显示的待确认类型。
   * @param {string} [taskOverride] 直接指定任务名称（自检用）。
   * @param {{ force?: boolean }} [opts] force 为 true 时跳过前台抑制、也不自动关闭（自检用）。
   */
  function enqueue(key, session, kind, taskOverride, opts = {}) {
    if (disposed) return
    const task = typeof taskOverride === 'string' && taskOverride.length > 0
      ? taskOverride
      : taskNameOf(ctx, session)
    const sessionId = typeof session?.id === 'string' ? session.id : ''
    pending.set(key, { key, task, kind, sessionId, force: opts.force === true })
    if (!showing) drain()
  }

  // --- 需要选择：模型调用会交还控制权的工具时提醒。
  // DSH 没有“提问”事件（`ctx.userQuestions.ask()` 是服务调用而非事件），所以挂在
  // `tools/pre-execute` 上按工具名识别：ask_user_question = 提问，
  // exit_plan_mode = 计划审阅。两者都会阻塞在这一步直到你回答。
  // waterfall 必须 next()，否则工具根本不会执行。
  ctx.on('tools/pre-execute', (exec, next) => {
    const kind = ASKING_TOOLS.get(exec?.name)
    if (kind === undefined || !config.notifyOnQuestion) return next()
    if (!shouldNotify(exec.agent, config.ignoreSubagents)) return next()
    if (kind === KIND_LABELS.planReview) {
      trace('pre-execute: exit_plan_mode')
      enqueue('plan-review', exec.agent?.session, kind)
    } else {
      trace('pre-execute: ask_user_question')
      enqueue(`question:${exec.callId ?? 'unknown'}`, exec.agent?.session, kind)
    }
    return next()
  })

  // --- 需要权限：审批请求到达时提醒。
  // waterfall 必须 next() 交回后续 answerer，否则审批会被解析成 unavailable
  // （失败关闭）。审批策略为 never 时这里根本不会触发——那是服务端在分发之前
  // 就短路了，不是本插件的问题。
  // 第三个参数 true 是 prepend：内置 Web 端审批桥在插件挂载之后再注册，只有排到
  // 它前面才看得到 approval/request（否则桥会先 resolve，后续 listener 不再执行）。
  ctx.on('approval/request', (request, next) => {
    if (config.notifyOnApproval && shouldNotify(request?.agent, config.ignoreSubagents)) {
      const tool = typeof request?.toolName === 'string' && request.toolName.length > 0 ? request.toolName : '未知工具'
      trace(`approval/request: tool=${tool}`)
      enqueue(`approval:${request?.callId ?? request?.toolName ?? 'unknown'}`, request?.agent?.session, KIND_LABELS.approval)
    }
    return next()
  }, true)

  // --- 任务完成：agent 从 running 落到 idle 的那一次。
  // 维护性 idle（压缩、定时任务等）不产生状态翻转，因此不会误报；这里再显式只认
  // running→idle，不依赖上游是否只在翻转时发事件。
  ctx.on('agent/status', ({ agent, status }) => {
    const id = agent?.id ?? 'unknown'
    const previous = lastStatus.get(id)
    lastStatus.set(id, status)
    if (status === 'running' && previous !== 'running') captureAttribution(agent)
    if (!config.notifyOnComplete || status !== 'idle' || previous !== 'running') return
    if (!shouldNotify(agent, config.ignoreSubagents)) return
    const now = Date.now()
    const last = lastCompleteAt.get(id)
    if (last !== undefined && now - last < config.completeCooldownMs) {
      trace(`agent/status: idle for ${id} suppressed by cooldown`)
      return
    }
    lastCompleteAt.set(id, now)
    const session = agent?.session
    const lastTurn = session?.events?.findLast?.((event) => event.type === 'turn/end')
    const reason = lastTurn?.data?.reason?.kind
    trace(`agent/status: idle session=${id} reason=${String(reason ?? 'none')}`)
    enqueue(`done:${id}`, session, KIND_LABELS.complete)
  })

  if (config.testOnStart) {
    // 自检通路：patch 热重载即弹一张；改回 false 再保存即不再自检。
    trace('testOnStart: enqueue self-test')
    enqueue('self-test', undefined, KIND_LABELS.selfTest, config.title, { force: true })
  }
}
