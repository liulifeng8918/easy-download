// Deterministic, explicitly labelled instructional diagrams, not fake screenshots.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'electron', 'renderer', 'assets', 'guide');
const base = `<style>
*{box-sizing:border-box}body{margin:0;background:#f4f8fd;color:#172d48;font:18px "Microsoft YaHei","Segoe UI",sans-serif}.canvas{padding:30px;min-height:520px}.step{color:#1673e9;font-size:14px;font-weight:700;letter-spacing:1px}.heading{font-size:28px;margin:8px 0 22px}.window{background:white;border:1px solid #cbd9eb;border-radius:12px;overflow:hidden}.bar{padding:14px 18px;background:#edf3fb;border-bottom:1px solid #dbe5f1;display:flex;align-items:center;gap:12px}.address{background:white;border-radius:7px;padding:9px 14px;flex:1;color:#3a5a7e;font-size:16px}.content{padding:20px}.row{display:flex;align-items:center;gap:14px}.between{justify-content:space-between}.muted{color:#71859e;font-size:15px;line-height:1.65}.btn{display:inline-block;padding:12px 18px;border:1px solid #bfd5f1;border-radius:8px;color:#1769bf;background:white;font-size:16px}.blue{background:#1976f3;color:white;border-color:#1976f3}.highlight{outline:3px solid #ffae3e;outline-offset:5px}.tag{display:inline-block;padding:5px 10px;background:#fff0d8;color:#8c5d10;border-radius:6px;font-size:14px}.callout{margin-top:20px;background:#eaf3ff;border-left:4px solid #1976f3;padding:13px 16px;font-size:17px;line-height:1.7}.note{font-size:12px;color:#889ab0;margin-top:16px}.folder{padding:14px;border-radius:6px;color:#365b87}.selected{background:#eaf3ff;border:1px solid #93bff4}.field{border:1px solid #cbd9eb;background:#fbfdff;border-radius:7px;padding:13px;font-size:17px;margin:10px 0}.switch{display:inline-block;width:36px;height:20px;background:#1976f3;border-radius:15px;vertical-align:middle;margin-left:10px}.switch:after{content:"";display:block;margin:3px 3px 3px auto;background:white;border-radius:50%;width:14px;height:14px}.menu{width:260px;border:1px solid #d9e5f3;border-radius:10px;padding:8px;background:white;box-shadow:0 9px 24px #183d6814}.menu div{padding:10px;border-radius:6px}.line{height:1px;background:#e0e8f3;margin:15px 0}
</style>`;
const diagrams = [
  ['01-unzip', '01  解压后启动', '先解压整个文件夹，再双击程序',
    '<div class="bar"><span>文件资源管理器</span><span class="address">下载 / 易下载绿色版</span></div><div class="content"><div class="row"><span class="btn highlight">全部解压缩</span><span class="tag">① 右键 ZIP，选择解压</span></div><div class="line"></div><div class="folder">resources　　locales　　其他运行文件</div><div class="folder selected">易下载.exe <span class="tag">② 解压完成后双击这个</span></div></div>',
    '不要在 ZIP 预览窗口里直接运行，也不要只复制 exe。保留解压后的整个文件夹。'],
  ['02-chrome', '02  加载 Chrome 扩展', '打开扩展页，先开开发者模式，再加载',
    '<div class="bar"><span>Chrome</span><span class="address highlight">chrome://extensions</span></div><div class="content"><div class="row between"><b>扩展程序</b><span class="highlight">开发者模式 <i class="switch"></i></span></div><p class="muted">① 在地址栏输入上方地址，回车。　② 打开右上角开关。</p><div class="row"><span class="btn highlight">加载已解压的扩展程序</span><span class="btn">打包扩展程序</span><span class="btn">更新</span></div><p class="muted">③ 点击左上角此按钮（部分版本叫“加载未打包的扩展程序”）。</p></div>',
    '不是在 Chrome 网上应用店搜索。此步骤加载的是易下载自带的 extension 文件夹。'],
  ['03-folder', '03  选择 extension 文件夹', '选择文件夹本身，不需要看见里面的文件',
    '<div class="bar"><b>选择扩展程序目录</b></div><div class="content"><div class="address">易下载绿色版 / resources / app / extension</div><div class="folder selected">extension <span class="tag">① 选中这个文件夹</span></div><p class="muted">窗口可能不显示 manifest.json 等文件，这是正常的：<br>这里选择的是文件夹，不是某个文件。</p><div class="row between"><span class="muted">文件夹：extension</span><span class="btn blue highlight">选择文件夹</span></div></div>',
    '先在易下载中点“打开扩展文件夹”，复制资源管理器地址；再到选择窗口粘贴这个地址，点击“选择文件夹”。'],
  ['04-pair', '04  连接易下载', '从软件复制连接码，在扩展设置中粘贴',
    '<div class="bar"><b>易下载浏览器设置</b></div><div class="content"><div class="row"><span class="btn">软件设置 → 复制连接码</span><span class="tag">① 点击复制</span></div><p class="muted">连接码只用于连接这台电脑上的易下载，请勿发给别人。</p><div class="field highlight">●●●●●●●●●●●●●●●●●●　<span class="tag">② 粘贴到这里</span></div><div class="row"><span class="btn blue highlight">保存连接</span><span class="tag">③ 点击保存</span></div></div>',
    '在 Chrome 扩展卡片点击“详细信息”→“扩展程序选项”，即可打开这个设置页。主程序保持运行。'],
  ['05-sync', '05  网站提示登录时', '先在 Chrome 登录，再主动同步登录状态',
    '<div class="bar"><b>易下载浏览器设置 · 按需同步登录状态</b></div><div class="content"><p class="muted">① 用同一个 Chrome 打开目标网站，确认视频能播放。</p><div class="field">douyin.com<br>tiktok.com</div><div class="row"><span class="btn blue highlight">保存并同步登录状态</span><span class="tag">② 点击同步</span></div><p class="muted">③ Chrome 询问网站权限时，确认网站正确后允许。</p></div>',
    '看到“同步成功”再回软件重试。仅复制连接码，不等于已经同步登录状态；公开内容通常不需要这一步。'],
  ['06-browser', '06  直接从浏览器下载', '两种方式都可以，不用反复复制链接',
    '<div class="bar"><span>Chrome</span><span class="address">已支持网站的视频播放页</span><span class="tag">工具栏扩展</span></div><div class="content"><div class="row between"><div><p class="muted">方式 A：点击工具栏“易下载”扩展</p><div class="menu"><div class="blue">下载当前视频</div><div>发送到易下载</div><div>浏览器设置</div></div></div><div><p class="muted">方式 B：在网页空白处或视频链接上右键</p><div class="menu"><div>返回</div><div>重新加载</div><div class="selected highlight">下载此视频</div></div></div></div></div>',
    '“下载当前视频”沿用软件默认偏好；“发送到易下载”先把链接填入首页，确认后下载。软件必须保持打开。'],
  ['07-done', '07  下载完成', '首页和下载任务，都能直接打开文件夹',
    '<div class="bar"><b>下载任务</b><span class="address">全部　　进行中　　已完成　　失败</span></div><div class="content"><div class="row between"><div><b>示例视频.mp4</b><p class="muted">已完成 · 视频已保存到你的下载目录</p></div><span class="btn blue highlight">打开文件夹</span></div><div class="line"></div><p class="muted">在打开的资源管理器中双击视频，即可播放查看。</p><div class="row"><span class="btn">清空记录</span><span class="tag">只清记录，不删除视频</span></div></div>',
    '如果任务失败，查看提示后点“重试”。保存目录也可以在首页修改。']
];
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1000,height:600},deviceScaleFactor:1.5});
    for (const [name,step,title,content,tip] of diagrams) {
      await page.setContent(base + '<div class="canvas"><div class="step">'+step+'</div><div class="heading">'+title+'</div><div class="window">'+content+'</div><div class="callout">'+tip+'</div><div class="note">操作示意图 · Chrome / Windows 版本不同，按钮名称或布局可能略有差异</div></div>');
      await page.locator('.canvas').screenshot({path:path.join(out,name+'.png')});
    }
  } finally { await browser.close(); }
  console.log(out);
})().catch(error=>{console.error(error);process.exitCode=1;});
