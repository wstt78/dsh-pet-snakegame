// 鲸鱼娘桌宠贪吃蛇 · 全局只读输入探针
// 原则：只判断“有没有输入”，绝不记录按了哪个键，不安装键盘钩子，不拦截输入。
// 输出：stdout 一行一个 JSON（JSONL），由 Electron 主进程读取后转发给渲染层。
//
// 事件：
//   {"e":"ready"}
//   {"e":"tick","t":<ms>,"x":<int>,"y":<int>,"idle":<ms>}   每 poll 毫秒一次
//   {"e":"key","t":<ms>}                                    任意按键“新按下”一次（长按自动重复不会重复发）
//   {"e":"click","t":<ms>,"b":"L|R|M"}                      鼠标按键“新按下”一次
//
// 说明：GetAsyncKeyState 轮询只读物理按键状态；GetLastInputInfo 取系统空闲时长；
//       两者都不需要窗口焦点，所以能覆盖“用户在别的程序里打字”的情况。

using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class InputHelper
{
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT p);

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("kernel32.dll")]
    private static extern uint GetTickCount();

    [DllImport("kernel32.dll")]
    private static extern ulong GetTickCount64();

    private static volatile bool _stop;
    private static readonly StringBuilder Line = new StringBuilder(256);

    // VK 1/2/4/5/6 是鼠标按键，单独用 click 事件表示，避免和“键盘输入”混淆。
    private static bool IsMouseVk(int vk)
    {
        return vk == 0x01 || vk == 0x02 || vk == 0x04 || vk == 0x05 || vk == 0x06;
    }

    private static void Emit(string s)
    {
        Console.Out.WriteLine(s);
        Console.Out.Flush();
    }

    private static void EmitTick(long t, int x, int y, long idle)
    {
        Line.Length = 0;
        Line.Append("{\"e\":\"tick\",\"t\":").Append(t)
            .Append(",\"x\":").Append(x)
            .Append(",\"y\":").Append(y)
            .Append(",\"idle\":").Append(idle)
            .Append('}');
        Emit(Line.ToString());
    }

    private static void EmitKey(long t)
    {
        Line.Length = 0;
        Line.Append("{\"e\":\"key\",\"t\":").Append(t).Append('}');
        Emit(Line.ToString());
    }

    private static void EmitClick(long t, string button)
    {
        Line.Length = 0;
        Line.Append("{\"e\":\"click\",\"t\":").Append(t).Append(",\"b\":\"").Append(button).Append("\"}");
        Emit(Line.ToString());
    }

    private static int Main(string[] args)
    {
        int poll = 20;
        foreach (string a in args)
        {
            if (a.StartsWith("--poll=", StringComparison.Ordinal))
            {
                int parsed;
                if (int.TryParse(a.Substring(7), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) && parsed >= 5)
                {
                    poll = parsed;
                }
            }
        }

        SetProcessDPIAware();

        // 只有显式 --stdin 时才监听父进程管道。默认不依赖 stdin：
        // 探针常被脚本直接拉起做测试，stdin 可能是空设备，ReadLine 立刻 EOF，
        // 若在这里置 _stop 会让探针只输出 ready 就退出（已踩）。
        bool watchStdin = false;
        foreach (string a in args)
        {
            if (a == "--stdin")
            {
                watchStdin = true;
            }
        }
        if (watchStdin)
        {
            var reader = new Thread(delegate()
            {
                try
                {
                    string line;
                    while ((line = Console.In.ReadLine()) != null)
                    {
                        if (line.Trim() == "quit")
                        {
                            break;
                        }
                    }
                }
                catch
                {
                }
                _stop = true;
            });
            reader.IsBackground = true;
            reader.Start();
        }

        var keyWasDown = new bool[256];
        var clickWasDown = new bool[3]; // 0=L 1=R 2=M
        const int VK_L = 0x01, VK_R = 0x02, VK_M = 0x04;

        Emit("{\"e\":\"ready\"}");

        while (!_stop)
        {
            long t = (long)GetTickCount64();

            POINT p;
            if (!GetCursorPos(out p))
            {
                p.X = 0;
                p.Y = 0;
            }

            var lii = new LASTINPUTINFO();
            lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            uint idle = 0;
            if (GetLastInputInfo(ref lii))
            {
                idle = unchecked((uint)GetTickCount() - lii.dwTime);
            }

            EmitTick(t, p.X, p.Y, (long)idle);

            // 键盘：逐键只看“状态是否从抬起变成按下”。长按的自动重复在轮询里保持按下，不会重复发。
            for (int vk = 1; vk < 255; vk++)
            {
                if (IsMouseVk(vk))
                {
                    continue;
                }
                bool down = (GetAsyncKeyState(vk) & 0x8000) != 0;
                if (down && !keyWasDown[vk])
                {
                    EmitKey(t);
                }
                keyWasDown[vk] = down;
            }

            // 鼠标按键：同样只在“新按下”时发事件。
            bool[] clicks = new bool[3];
            clicks[0] = (GetAsyncKeyState(VK_L) & 0x8000) != 0;
            clicks[1] = (GetAsyncKeyState(VK_R) & 0x8000) != 0;
            clicks[2] = (GetAsyncKeyState(VK_M) & 0x8000) != 0;
            string[] names = { "L", "R", "M" };
            for (int i = 0; i < 3; i++)
            {
                if (clicks[i] && !clickWasDown[i])
                {
                    EmitClick(t, names[i]);
                }
                clickWasDown[i] = clicks[i];
            }

            Thread.Sleep(poll);
        }

        return 0;
    }
}
