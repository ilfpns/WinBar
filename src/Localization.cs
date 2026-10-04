namespace WinBar;

// WinBar 표시 언어(한국어 · 中文 · 日本語 · English).
// 화면 문구는 코드에 한국어 원문으로 적고, 그리는 순간 L.T("원문")으로 지금 언어의 번역을 찾는다.
// 번역표에 없는 문구는 원문 그대로 보인다. 설정에서 언어를 바꾸면 다음 그리기부터 바로 바뀐다.
internal static class L
{
    // 설정의 언어 목록: 코드, 앞에 붙는 짧은 표시, 그 언어로 쓴 이름
    public static readonly (string Code, string Badge, string Name)[] Languages =
    [
        ("ko", "한", "한국어"),
        ("zh", "中", "中文"),
        ("ja", "日", "日本語"),
        ("en", "E", "English")
    ];

    public static string Code => AppSettings.Current.Language is "en" or "zh" or "ja" ? AppSettings.Current.Language : "ko";

    public static string T(string korean)
    {
        string code = Code;
        if (code == "ko") return korean;
        int index = code switch { "en" => 0, "zh" => 1, _ => 2 };
        return Table.TryGetValue(korean, out string[]? translated) ? translated[index] : korean;
    }

    // 숫자가 들어가는 문구: 원문 틀("절전까지 {0}% 남음")을 번역한 뒤 값을 채운다.
    public static string F(string korean, params object[] values) => string.Format(T(korean), values);

    // ── 날짜·시각 ──────────────────────────────────────────────
    private static readonly string[] EnglishDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    private static readonly string[] EnglishLongDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    private static readonly string[] EnglishMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    private static readonly string[] EnglishLongMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // 메뉴바 시계: (날짜, 시각). 예) 한: "10월 2일 (금)", "오전 9:37:26" · 영: "Fri Oct 2", "9:37:26 AM"
    public static (string Date, string Time) Clock(DateTime value, bool use24Hour)
    {
        string time24 = $"{value:HH}:{value:mm}:{value:ss}";
        int hour = value.Hour % 12 == 0 ? 12 : value.Hour % 12;
        string time12 = $"{hour}:{value:mm}:{value:ss}";
        bool morning = value.Hour < 12;
        int day = (int)value.DayOfWeek;
        return Code switch
        {
            "en" => ($"{EnglishDays[day]} {EnglishMonths[value.Month - 1]} {value.Day}", use24Hour ? time24 : $"{time12} {(morning ? "AM" : "PM")}"),
            "zh" => ($"{value.Month}月{value.Day}日 周{"日一二三四五六"[day]}", use24Hour ? time24 : $"{(morning ? "上午" : "下午")}{time12}"),
            "ja" => ($"{value.Month}月{value.Day}日({"日月火水木金土"[day]})", use24Hour ? time24 : $"{(morning ? "午前" : "午後")} {time12}"),
            _ => ($"{value.Month}월 {value.Day}일 ({"일월화수목금토"[day]})", use24Hour ? time24 : $"{(morning ? "오전" : "오후")} {time12}")
        };
    }

    // 달력 제목 "2026년 10월" / "October 2026" / "2026年10月"
    public static string MonthTitle(DateTime month) => Code switch
    {
        "en" => $"{EnglishLongMonths[month.Month - 1]} {month.Year}",
        "zh" or "ja" => $"{month.Year}年{month.Month}月",
        _ => $"{month.Year}년 {month.Month}월"
    };

    // 달력 부제목 "오늘 10월 2일 금요일"
    public static string TodayLine(DateTime today)
    {
        int day = (int)today.DayOfWeek;
        return Code switch
        {
            "en" => $"Today, {EnglishLongDays[day]}, {EnglishLongMonths[today.Month - 1]} {today.Day}",
            "zh" => $"今天 {today.Month}月{today.Day}日 星期{"日一二三四五六"[day]}",
            "ja" => $"今日 {today.Month}月{today.Day}日 {"日月火水木金土"[day]}曜日",
            _ => $"오늘 {today.Month}월 {today.Day}일 {"일월화수목금토"[day]}요일"
        };
    }

    // 달력 요일 머리글(일요일부터)
    public static string[] WeekdayHeads => Code switch
    {
        "en" => ["S", "M", "T", "W", "T", "F", "S"],
        "zh" => ["日", "一", "二", "三", "四", "五", "六"],
        "ja" => ["日", "月", "火", "水", "木", "金", "土"],
        _ => ["일", "월", "화", "수", "목", "금", "토"]
    };

    // 남은 시간 "1시간 45분" / "1 hr 45 min"
    public static string Duration(int minutes) => minutes >= 60
        ? F("{0}시간 {1}분", minutes / 60, minutes % 60)
        : F("{0}분", minutes);

    // 지난 시간 "3분 전" / "3 min ago"
    public static string Ago(DateTime time)
    {
        TimeSpan span = DateTime.Now - time;
        if (span.TotalMinutes < 1) return T("방금");
        if (span.TotalHours < 1) return F("{0}분 전", (int)span.TotalMinutes);
        if (span.TotalDays < 1) return F("{0}시간 전", (int)span.TotalHours);
        if (span.TotalDays < 30) return F("{0}일 전", (int)span.TotalDays);
        // 30일이 넘으면 날짜로. PC 지역 설정의 구분 기호("8-18" 등)를 따르지 않고 표시 언어 형식으로 쓴다.
        return Code switch
        {
            "en" => $"{EnglishMonths[time.Month - 1]} {time.Day}",
            "zh" or "ja" => $"{time.Month}月{time.Day}日",
            _ => $"{time.Month}월 {time.Day}일"
        };
    }

    // ── 번역표: 한국어 원문 → [English, 中文, 日本語] ─────────────────
    private static readonly Dictionary<string, string[]> Table = new()
    {
        // 로고 메뉴
        ["설정"] = ["Settings", "设置", "設定"],
        ["WinBar 종료"] = ["Quit WinBar", "退出 WinBar", "WinBar を終了"],

        // 공통
        ["켜짐"] = ["On", "已开启", "オン"],
        ["꺼짐"] = ["Off", "已关闭", "オフ"],
        ["연결됨"] = ["Connected", "已连接", "接続済み"],
        ["알 수 없음"] = ["Unknown", "未知", "不明"],
        ["{0}개"] = ["{0}", "{0}个", "{0}件"],
        ["외 {0}개"] = ["{0} more", "还有{0}个", "他{0}件"],
        ["{0}시간 {1}분"] = ["{0} hr {1} min", "{0}小时{1}分钟", "{0}時間{1}分"],
        ["{0}분"] = ["{0} min", "{0}分钟", "{0}分"],
        ["방금"] = ["Just now", "刚刚", "たった今"],
        ["{0}분 전"] = ["{0} min ago", "{0}分钟前", "{0}分前"],
        ["{0}시간 전"] = ["{0} hr ago", "{0}小时前", "{0}時間前"],
        ["{0}일 전"] = ["{0} days ago", "{0}天前", "{0}日前"],

        // 배터리
        ["배터리"] = ["Battery", "电池", "バッテリー"],
        ["전원 연결됨 · 충전 중"] = ["Power connected · Charging", "已接通电源 · 正在充电", "電源接続 · 充電中"],
        ["배터리 사용 중"] = ["On battery", "正在使用电池", "バッテリー使用中"],
        [" · 절전 모드 켜짐"] = [" · Battery Saver on", " · 省电模式已开启", " · 省電力モード オン"],
        ["충전 중"] = ["Charging", "正在充电", "充電中"],
        ["예측 중"] = ["Estimating", "正在估算", "推定中"],
        ["남은 사용 예측 시간"] = ["Estimated time left", "预计剩余时间", "推定残り時間"],
        ["절전 모드 켜짐"] = ["Battery Saver on", "省电模式已开启", "省電力モード オン"],
        ["절전까지 {0}% 남음"] = ["{0}% until Battery Saver", "距省电模式还有{0}%", "省電力まで残り{0}%"],
        ["곧 켜짐"] = ["Turning on soon", "即将开启", "まもなくオン"],
        ["기준을 읽을 수 없음"] = ["Threshold unavailable", "无法读取阈值", "しきい値を取得できません"],
        ["절전 모드"] = ["Battery Saver", "省电模式", "省電力モード"],
        ["전원 모드"] = ["Power mode", "电源模式", "電源モード"],
        ["배터리 설정…"] = ["Battery Settings…", "电池设置…", "バッテリー設定…"],
        ["최고의 전원 효율"] = ["Best power efficiency", "最佳能效", "最適な電力効率"],
        ["균형"] = ["Balanced", "平衡", "バランス"],
        ["최고 성능"] = ["Best performance", "最佳性能", "最適なパフォーマンス"],
        ["게임 모드"] = ["Game mode", "游戏模式", "ゲームモード"],
        ["혼합 현실"] = ["Mixed reality", "混合现实", "Mixed Reality"],

        // Wi-Fi
        ["연결 중…"] = ["Connecting…", "正在连接…", "接続中…"],
        ["유선 연결"] = ["Wired", "有线连接", "有線接続"],
        ["연결 안 됨"] = ["Not connected", "未连接", "未接続"],
        ["유선 네트워크"] = ["Ethernet", "有线网络", "有線ネットワーク"],
        ["연결된 네트워크 없음"] = ["No network", "没有网络", "ネットワークなし"],
        ["현재 속도"] = ["Current speed", "当前速度", "現在の速度"],
        ["측정 중…"] = ["Measuring…", "正在测量…", "測定中…"],
        ["저장된 네트워크"] = ["Known Networks", "已保存的网络", "保存済みネットワーク"],
        ["저장된 네트워크 없음"] = ["No known networks", "没有已保存的网络", "保存済みネットワークなし"],
        ["네트워크 설정…"] = ["Network Settings…", "网络设置…", "ネットワーク設定…"],

        // 사운드
        ["사운드"] = ["Sound", "声音", "サウンド"],
        ["출력 장치 없음"] = ["No output device", "没有输出设备", "出力デバイスなし"],
        ["음소거"] = ["Muted", "静音", "ミュート"],
        ["출력 장치"] = ["Output", "输出设备", "出力デバイス"],
        ["사용할 수 있는 장치 없음"] = ["No devices available", "没有可用设备", "利用できるデバイスなし"],
        ["볼륨 믹서 열기"] = ["Open Volume Mixer", "打开音量合成器", "音量ミキサーを開く"],
        ["사운드 설정…"] = ["Sound Settings…", "声音设置…", "サウンド設定…"],
        ["알 수 없는 장치"] = ["Unknown device", "未知设备", "不明なデバイス"],

        // 제어 센터
        ["제어 센터"] = ["Control Center", "控制中心", "コントロールセンター"],
        ["켜는 중…"] = ["Turning on…", "正在开启…", "オンにしています…"],
        ["끄는 중…"] = ["Turning off…", "正在关闭…", "オフにしています…"],
        ["확인 중…"] = ["Checking…", "正在检查…", "確認中…"],
        ["켜짐 · 연결 {0}개"] = ["On · {0} connected", "已开启 · 已连接{0}个", "オン · 接続 {0}台"],
        ["입력 소스"] = ["Input Source", "输入法", "入力ソース"],
        ["방해 금지"] = ["Do Not Disturb", "勿扰模式", "応答不可"],
        ["켜짐 · 알림 꺼짐"] = ["On · Notifications off", "已开启 · 通知已关闭", "オン · 通知オフ"],
        ["디스플레이"] = ["Display", "显示器", "ディスプレイ"],
        ["디스플레이 설정…"] = ["Display Settings…", "显示设置…", "ディスプレイ設定…"],
        ["시스템 사용량"] = ["System Usage", "系统使用情况", "システム使用状況"],
        ["메모리"] = ["Memory", "内存", "メモリ"],
        ["연결된 기기"] = ["Connected Devices", "已连接的设备", "接続中のデバイス"],
        ["연결된 기기 없음"] = ["No connected devices", "没有已连接的设备", "接続中のデバイスなし"],
        ["연결"] = ["Connect", "连接", "接続"],
        ["연결 실패"] = ["Couldn't connect", "连接失败", "接続できませんでした"],
        ["Bluetooth 없음"] = ["No Bluetooth", "没有蓝牙", "Bluetooth なし"],
        ["Bluetooth 꺼짐"] = ["Bluetooth off", "蓝牙已关闭", "Bluetooth オフ"],
        ["등록된 기기"] = ["My Devices", "已配对的设备", "登録済みデバイス"],
        ["등록된 기기 없음"] = ["No paired devices", "没有已配对的设备", "登録済みデバイスなし"],
        ["새 블루투스 기기 찾기…"] = ["Find New Bluetooth Device…", "查找新的蓝牙设备…", "新しいBluetoothデバイスを探す…"],

        // 달리는 고양이
        ["달리는 고양이"] = ["RunCat", "奔跑的猫", "走るネコ"],
        ["달리는 고양이 (CPU 사용량)"] = ["RunCat (CPU usage)", "奔跑的猫（CPU 使用率）", "走るネコ（CPU使用率）"],
        ["CPU {0}% · 초당 {1}걸음"] = ["CPU {0}% · {1} steps/sec", "CPU {0}% · 每秒{1}步", "CPU {0}% · 毎秒{1}歩"],

        // 개인 정보 표시
        ["개인 정보 표시"] = ["Privacy Indicators", "隐私指示", "プライバシー表示"],
        ["카메라 사용 중"] = ["Camera in use", "摄像头使用中", "カメラ使用中"],
        ["마이크 사용 중"] = ["Microphone in use", "麦克风使用中", "マイク使用中"],
        ["사용 중인 장치 없음"] = ["No devices in use", "没有正在使用的设备", "使用中のデバイスなし"],

        // 더 보기
        ["더 보기"] = ["More", "更多", "その他"],
        ["저장 공간"] = ["Storage", "存储空间", "ストレージ"],
        ["드라이브 정보를 읽을 수 없음"] = ["Can't read drive info", "无法读取驱动器信息", "ドライブ情報を取得できません"],
        ["{0} 남음 / {1}"] = ["{0} free of {1}", "可用 {0} / 共 {1}", "空き {0} / {1}"],
        ["로컬 디스크"] = ["Local Disk", "本地磁盘", "ローカル ディスク"],
        ["최근 다운로드"] = ["Recent Downloads", "最近下载", "最近のダウンロード"],
        ["최근 다운로드한 파일 없음"] = ["No recent downloads", "没有最近下载的文件", "最近のダウンロードなし"],
        ["다운로드 폴더 열기"] = ["Open Downloads Folder", "打开下载文件夹", "ダウンロードフォルダーを開く"],
        ["빠른 동작"] = ["Quick Actions", "快捷操作", "クイック操作"],
        ["화면 캡처"] = ["Screenshot", "截屏", "スクリーンショット"],
        ["화면 잠금"] = ["Lock Screen", "锁定屏幕", "画面をロック"],
        ["절전"] = ["Sleep", "睡眠", "スリープ"],
        ["휴지통 비우기"] = ["Empty Recycle Bin", "清空回收站", "ごみ箱を空にする"],

        // 설정
        ["WinBar 설정"] = ["WinBar Settings", "WinBar 设置", "WinBar 設定"],
        ["로그인 시 자동 실행 (Windows 설정)"] = ["Open at Login (Windows Settings)", "登录时启动（Windows 设置）", "ログイン時に起動（Windows の設定）"],
        ["로그인 시 자동 실행"] = ["Open at Login", "登录时启动", "ログイン時に起動"],
        ["일반"] = ["General", "通用", "一般"],
        ["시작"] = ["Startup", "启动", "起動"],
        ["시계"] = ["Clock", "时钟", "時計"],
        ["24시간 형식"] = ["24-hour time", "24小时制", "24時間表示"],
        ["모양"] = ["Appearance", "外观", "外観"],
        ["테마"] = ["Theme", "主题", "テーマ"],
        ["다크 모드 전환"] = ["Switch to Dark Mode", "切换到深色模式", "ダークモードに切り替え"],
        ["화이트 모드 전환"] = ["Switch to Light Mode", "切换到浅色模式", "ライトモードに切り替え"],
        ["메뉴바 불투명도"] = ["Menu Bar Opacity", "菜单栏不透明度", "メニューバーの不透明度"],
        ["0% 배경 없음 · 100% 불투명"] = ["0% no background · 100% opaque", "0% 无背景 · 100% 不透明", "0% 背景なし · 100% 不透明"],
        ["메뉴바"] = ["Menu Bar", "菜单栏", "メニューバー"],
        ["표시할 항목"] = ["Show in Menu Bar", "显示项目", "表示する項目"],
        ["카메라·마이크 사용 표시"] = ["Camera & Mic Indicator", "摄像头·麦克风使用指示", "カメラ・マイク使用表示"],
        ["네트워크"] = ["Network", "网络", "ネットワーク"],
        ["소리"] = ["Sound", "声音", "サウンド"],
        ["제어 센터·날짜·시간은 항상 표시"] = ["Control Center and clock are always shown", "控制中心和日期时间始终显示", "コントロールセンターと日時は常に表示"],
        ["아이콘 간격"] = ["Icon Spacing", "图标间距", "アイコンの間隔"],
        ["아이콘 사이 간격"] = ["Space Between Icons", "图标之间的间距", "アイコン間の間隔"],
        ["언어"] = ["Language", "语言", "言語"],
        ["표시 언어"] = ["Display Language", "显示语言", "表示言語"],
        ["정보"] = ["About", "关于", "情報"],
        ["WinBar {0} (프로토타입)"] = ["WinBar {0} (Prototype)", "WinBar {0}（原型）", "WinBar {0}（プロトタイプ）"],
        ["{0} (프로토타입)"] = ["{0} (Prototype)", "{0}（原型）", "{0}（プロトタイプ）"],
        ["앱 정보"] = ["App Info", "应用信息", "アプリ情報"],
        ["버전"] = ["Version", "版本", "バージョン"],
        ["지원 OS"] = ["Supported OS", "支持的系统", "対応OS"],
        ["아이콘"] = ["Icons", "图标", "アイコン"],
        ["설정 파일"] = ["Settings file", "设置文件", "設定ファイル"],
        ["설정은 이 PC에만 저장 · 외부 전송 없음"] = ["Settings stay on this PC · nothing is sent", "设置仅保存在本机 · 不会外传", "設定はこのPCにのみ保存 · 外部送信なし"]
    };
}
