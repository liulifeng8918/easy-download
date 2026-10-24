from __future__ import annotations

import os
import textwrap
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "易下载用户操作手册.pdf"
ASSET = ROOT / "electron" / "renderer" / "assets" / "browser-download-hero.png"
HOME = ROOT / "output" / "playwright" / "home.png"
SETTINGS = ROOT / "output" / "playwright" / "settings.png"
CHROME_MENU = ROOT / "docs" / "manual-assets" / "connection-01-chrome-menu.png"
CHROME_EXTENSIONS = ROOT / "docs" / "manual-assets" / "connection-02-extensions.png"
CHROME_FOLDER = ROOT / "docs" / "manual-assets" / "connection-03-select-folder.png"
CHROME_WIZARD = ROOT / "docs" / "manual-assets" / "connection-04-wizard.png"
CHROME_CONTEXT = ROOT / "docs" / "manual-assets" / "connection-05-context-menu.png"
TMP = ROOT / "tmp" / "pdfs"
TMP.mkdir(parents=True, exist_ok=True)

FONT = "SimHei"
FONT_PATH = Path(r"C:\Windows\Fonts\simhei.ttf")
pdfmetrics.registerFont(TTFont(FONT, str(FONT_PATH)))

PAGE_W, PAGE_H = A4
BLUE = colors.HexColor("#1976F3")
BLUE_DARK = colors.HexColor("#14233B")
BLUE_SOFT = colors.HexColor("#EAF3FF")
CYAN_SOFT = colors.HexColor("#F3FBFF")
TEXT = colors.HexColor("#243A56")
MUTED = colors.HexColor("#65748B")
BORDER = colors.HexColor("#D9E3EF")
WARN = colors.HexColor("#FFF7E7")
SUCCESS = colors.HexColor("#E9F8F1")


def wrap(text: str, max_width: float, size: float) -> list[str]:
    lines: list[str] = []
    for paragraph in str(text).split("\n"):
        current = ""
        for char in paragraph:
            candidate = current + char
            if current and pdfmetrics.stringWidth(candidate, FONT, size) > max_width:
                lines.append(current)
                current = char
            else:
                current = candidate
        lines.append(current)
    return lines


def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, size: float = 10.5, leading: float = 17, color=TEXT) -> float:
    c.setFont(FONT, size)
    c.setFillColor(color)
    for line in wrap(text, width, size):
        c.drawString(x, y, line)
        y -= leading
    return y


def rounded_box(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill=colors.white, stroke=BORDER, radius: float = 10):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def header(c: canvas.Canvas, title: str, subtitle: str = ""):
    c.setFillColor(BLUE)
    c.rect(0, PAGE_H - 74, PAGE_W, 74, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(FONT, 19)
    c.drawString(38, PAGE_H - 37, title)
    if subtitle:
        c.setFont(FONT, 9)
        c.setFillColor(colors.HexColor("#DCEBFF"))
        c.drawString(39, PAGE_H - 55, subtitle)


def footer(c: canvas.Canvas, page: int):
    c.setStrokeColor(BORDER)
    c.line(38, 31, PAGE_W - 38, 31)
    c.setFont(FONT, 8)
    c.setFillColor(MUTED)
    c.drawString(38, 18, "易下载 1.0.0  |  本手册面向 Windows 用户")
    c.drawRightString(PAGE_W - 38, 18, f"{page}")


def draw_image_contain(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float, bg=colors.white):
    if not path.exists():
        rounded_box(c, x, y, w, h, fill=CYAN_SOFT)
        draw_wrapped(c, "图片将在安装包中显示。", x + 12, y + h / 2, w - 24, 10, 15, MUTED)
        return
    image = ImageReader(str(path))
    iw, ih = image.getSize()
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    rounded_box(c, x, y, w, h, fill=colors.white, stroke=BORDER)
    c.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, preserveAspectRatio=True, mask="auto")


def step_card(c: canvas.Canvas, number: str, title: str, body: str, x: float, y: float, w: float, h: float, fill=CYAN_SOFT):
    rounded_box(c, x, y, w, h, fill=fill, stroke=BORDER)
    c.setFillColor(BLUE)
    c.circle(x + 23, y + h - 24, 12, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(FONT, 10)
    c.drawCentredString(x + 23, y + h - 28, number)
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 11)
    c.drawString(x + 43, y + h - 28, title)
    draw_wrapped(c, body, x + 15, y + h - 52, w - 30, 9.2, 14, MUTED)


def image_step(c: canvas.Canvas, number: str, title: str, body: str, image: Path, x: float, y: float, w: float, h: float):
    rounded_box(c, x, y, w, h, fill=CYAN_SOFT, stroke=BORDER)
    c.setFillColor(BLUE)
    c.circle(x + 21, y + h - 21, 11, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(FONT, 9)
    c.drawCentredString(x + 21, y + h - 25, number)
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 10.5)
    c.drawString(x + 39, y + h - 25, title)
    draw_image_contain(c, image, x + 10, y + 34, w - 20, h - 67)
    draw_wrapped(c, body, x + 12, y + 23, w - 24, 8.2, 11, MUTED)


def crop_settings():
    try:
        from PIL import Image
        image = Image.open(SETTINGS)
        width, height = image.size
        # The connection block is at the top of the settings page; keep the
        # screenshot focused on the four visual steps and action buttons.
        crop = image.crop((0, int(height * 0.08), width, int(height * 0.43)))
        target = TMP / "chrome-connection.png"
        crop.save(target)
        return target
    except Exception:
        return SETTINGS


def make_pdf():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=A4)

    # 1. Cover
    c.setFillColor(colors.HexColor("#F6F9FC"))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.rect(0, PAGE_H - 88, PAGE_W, 88, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(FONT, 25)
    c.drawString(38, PAGE_H - 44, "易下载")
    c.setFont(FONT, 10)
    c.setFillColor(colors.HexColor("#DCEBFF"))
    c.drawString(39, PAGE_H - 63, "EASY DOWNLOAD")
    draw_image_contain(c, ASSET, 38, 366, PAGE_W - 76, 285, colors.white)
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 28)
    c.drawString(38, 307, "从解压到下载完成")
    c.setFont(FONT, 16)
    c.setFillColor(BLUE)
    c.drawString(38, 277, "连接 Chrome，直接下载浏览器里的视频")
    draw_wrapped(c, "这份手册适合第一次使用易下载的用户。按照页面顺序操作，不需要理解 Cookie、代理端口或下载引擎。", 38, 238, PAGE_W - 76, 11, 18, MUTED)
    rounded_box(c, 38, 132, PAGE_W - 76, 65, fill=BLUE_SOFT, stroke=colors.HexColor("#C5DDF8"))
    c.setFont(FONT, 12)
    c.setFillColor(BLUE_DARK)
    c.drawString(55, 169, "完整路径")
    c.setFont(FONT, 10.5)
    c.setFillColor(MUTED)
    c.drawString(55, 146, "解压绿色版 -> 打开程序 -> 需要登录时连接 Chrome -> 粘贴链接 -> 打开文件夹")
    footer(c, 1)
    c.showPage()

    # 2. First launch
    header(c, "1  解压与首次启动", "整个文件夹一起保留，程序不需要另外安装 Python")
    y = PAGE_H - 112
    step_card(c, "1", "解压整个文件夹", "右键 ZIP 文件，选择“解压到当前文件夹”或“解压到易下载”。不要只复制其中的 exe 文件。", 38, y - 104, 250, 88)
    step_card(c, "2", "双击启动程序", "进入解压后的文件夹，双击“易下载.exe”。也可以双击文件夹里的“启动易下载.cmd”。", 307, y - 104, 250, 88)
    step_card(c, "3", "Windows 安全提示", "如果出现“未知发布者”，先确认文件来自你的发行方，再按系统允许方式启动。安装包未配置数字签名时可能出现此提示。", 38, y - 214, 250, 88, fill=WARN)
    step_card(c, "4", "看到首页即可下载", "首页只有一条主路径：粘贴视频链接，选择画质、格式、保存目录和代理策略，然后点击“开始下载”。", 307, y - 214, 250, 88, fill=SUCCESS)
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 15)
    c.drawString(38, y - 270, "启动后你会看到")
    draw_image_contain(c, HOME, 38, 86, PAGE_W - 76, 230)
    footer(c, 2)
    c.showPage()

    # 3. Homepage operation
    header(c, "2  首页下载", "免费单个下载不需要激活码")
    y = PAGE_H - 112
    draw_image_contain(c, HOME, 38, 390, PAGE_W - 76, 300)
    step_card(c, "1", "粘贴链接", "可以粘贴视频播放页，也可以粘贴抖音、小红书的分享文案，易下载会先识别其中的正确链接。", 38, 255, 250, 98)
    step_card(c, "2", "选择参数", "画质选择“最佳画质”最省心；格式可以选 MP4、MKV 或 MP3；“更改”可以选择保存目录。", 307, 255, 250, 98)
    step_card(c, "3", "代理策略", "不确定时选择“自动检测代理”。普通国内网站通常直连，海外网站可能需要代理软件。", 38, 142, 250, 98)
    step_card(c, "4", "开始并查看", "点击“开始下载”。任务会出现在首页底部和“下载任务”页面，完成后可以直接点击“打开文件夹”。", 307, 142, 250, 98)
    footer(c, 3)
    c.showPage()

    # 4. Chrome connection
    chrome_crop = crop_settings()
    header(c, "3  连接 Chrome 和网站登录状态", "只有网站提示需要登录时才做这一步")
    draw_wrapped(c, "如果浏览器里可以正常播放，但易下载提示“需要登录”，请按下面步骤同步登录状态。普通公开视频不需要连接 Chrome。", 38, PAGE_H - 110, PAGE_W - 76, 10.5, 17, TEXT)
    draw_image_contain(c, chrome_crop, 38, 400, PAGE_W - 76, 285)
    c.setFont(FONT, 9)
    c.setFillColor(MUTED)
    c.drawString(42, 386, "设置页中的连接区域：点击“连接 Chrome”后，程序会自动打开需要的窗口。")
    step_card(c, "1", "点击连接 Chrome", "在易下载设置页点击“连接 Chrome”。程序会同时打开 Chrome 扩展页、连接向导和 extension 文件夹。", 38, 264, 250, 100)
    step_card(c, "2", "加载已解压扩展", "在 Chrome 扩展页点击“加载已解压的扩展程序”，选择程序自动打开的 extension 文件夹。", 307, 264, 250, 100)
    step_card(c, "3", "等待自动连接", "扩展加载后会读取一次性连接票据，自动保存桥接凭据，不需要复制或粘贴连接码。", 38, 147, 250, 100)
    step_card(c, "4", "回到易下载重试", "连接完成后回到易下载，已发现的平台会自动同步登录状态，再次点击失败任务的“重试”。", 307, 147, 250, 100)
    footer(c, 4)
    c.showPage()

    # 5. User-provided Chrome screenshots
    header(c, "4  Chrome 实际操作截图", "按照图片顺序操作，不需要查看 Cookie 内容")
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 12)
    c.drawString(38, PAGE_H - 110, "五张截图对应五个动作")
    image_step(c, "1", "打开 Chrome 扩展入口", "点击右上角菜单，再进入“扩展程序”。", CHROME_MENU, 38, 540, 250, 166)
    image_step(c, "2", "点击加载未打包扩展程序", "在扩展页面点击左上角按钮。", CHROME_EXTENSIONS, 307, 540, 250, 166)
    image_step(c, "3", "选择 extension 文件夹", "在文件夹选择窗口粘贴路径并确认选择。", CHROME_FOLDER, 38, 350, 250, 166)
    image_step(c, "4", "等待连接向导完成", "看到易下载连接向导后，等待状态变为已连接。", CHROME_WIZARD, 307, 350, 250, 166)
    image_step(c, "5", "网页右键下载视频", "安装成功后，在视频页面右键选择“下载此视频”。", CHROME_CONTEXT, 38, 160, 250, 166)
    step_card(c, "✓", "回到易下载", "连接成功后关闭连接向导，回到易下载重试需要登录的视频。", 307, 160, 250, 166, fill=SUCCESS)
    footer(c, 5)
    c.showPage()

    # 6. Chrome click map
    header(c, "5  Chrome 里具体点击哪里", "按这个顺序操作，不需要查看 Cookie 内容")
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 15)
    c.drawString(38, PAGE_H - 112, "Chrome 操作路径")
    step_card(c, "A", "打开 Chrome 扩展页", "程序已经自动打开 chrome://extensions；如果没有打开，也可以在地址栏输入它。", 38, 535, 250, 92, fill=BLUE_SOFT)
    step_card(c, "B", "加载已解压扩展", "点击“加载已解压的扩展程序”，选择易下载自动打开的 extension 文件夹。", 307, 535, 250, 92, fill=BLUE_SOFT)
    step_card(c, "C", "等待连接向导变绿", "连接向导页面会自动显示“已连接”。如果没有变化，回到易下载重新点击“连接 Chrome”。", 38, 420, 250, 92, fill=BLUE_SOFT)
    step_card(c, "D", "不需要打开扩展设置", "新版流程不要求复制连接码或填写网站列表；手动设置只在高级排错时使用。", 307, 420, 250, 92, fill=BLUE_SOFT)
    step_card(c, "E", "自动同步已登记平台", "扩展会发现已登记平台的登录状态，易下载只保存必要的本机加密登录数据。", 38, 305, 250, 92, fill=SUCCESS)
    step_card(c, "F", "回到易下载重试", "回到下载任务，点击失败任务的“重试”，或回首页重新粘贴链接。", 307, 305, 250, 92, fill=SUCCESS)
    rounded_box(c, 38, 155, PAGE_W - 76, 102, fill=WARN, stroke=colors.HexColor("#F1D9A6"))
    c.setFillColor(colors.HexColor("#9A6E22"))
    c.setFont(FONT, 12)
    c.drawString(55, 230, "隐私提示")
    draw_wrapped(c, "易下载不会要求你查看或复制 Cookie 内容。扩展只同步你主动保留的网站登录状态，Cookie 在本机加密保存，不上传云端。", 55, 207, PAGE_W - 110, 10, 16, colors.HexColor("#806A3B"))
    footer(c, 6)
    c.showPage()

    # 7. Completion and troubleshooting
    header(c, "6  下载完成与常见问题", "完成任务后直接打开文件夹")
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 15)
    c.drawString(38, PAGE_H - 112, "下载完成后")
    step_card(c, "1", "看任务状态", "首页底部和“下载任务”页都会显示任务状态。完成项会显示“打开文件夹”。", 38, 565, 250, 92)
    step_card(c, "2", "打开文件位置", "点击“打开文件夹”，系统会直接打开本次任务的保存目录。", 307, 565, 250, 92)
    step_card(c, "3", "清空记录", "“清空记录”只清除软件里的任务记录，不会删除已经下载到磁盘的视频。", 38, 450, 250, 92)
    step_card(c, "4", "专业版整理", "专业版可以进入“整理输出”，统一命名、分类、保存字幕和封装独立字幕轨道。", 307, 450, 250, 92)
    rounded_box(c, 38, 210, PAGE_W - 76, 185, fill=CYAN_SOFT, stroke=BORDER)
    c.setFillColor(BLUE_DARK)
    c.setFont(FONT, 14)
    c.drawString(55, 365, "遇到失败时先看这三种提示")
    draw_wrapped(c, "需要登录：先完成 Chrome 连接，再重试。\n需要代理：在设置中点击“自动检测代理”，确认代理软件正在运行。\n暂不支持：请复制具体的视频播放页；特殊网站需求可以联系微信 open_java。", 55, 337, PAGE_W - 110, 10.5, 21, TEXT)
    c.setFillColor(MUTED)
    c.setFont(FONT, 9)
    c.drawString(55, 234, "不要把激活码、连接码、Cookie 文件或 cookies.dat 发给他人。")
    footer(c, 7)
    c.save()


if __name__ == "__main__":
    make_pdf()
    print(OUT)
