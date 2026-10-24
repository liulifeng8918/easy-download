# 易下载（Easy Download）

易下载是一个 Windows 本地视频下载工具：粘贴链接，或在 Chrome 页面右键发送到易下载，选择画质、格式和保存目录后下载。

当前正式版本：**1.0.0**

## 下载使用

请在 GitHub Releases 下载绿色版 ZIP 或 Windows 安装包。绿色版解压后双击 `易下载.exe` 即可启动，不需要另外安装 Python、Node.js 或 Electron。

单个链接下载免费；批量下载、字幕处理、自动整理等专业工作流需要专业版激活码。

## Chrome 连接

只有网站提示需要登录时才需要连接 Chrome：

1. 在易下载设置中点击“连接 Chrome”。
2. 在 Chrome 中点击“加载已解压的扩展程序”，选择程序自动打开的 `extension` 文件夹。

连接码和网站列表会自动处理。完整步骤见软件内 PDF 手册和 `docs/易下载用户操作手册.pdf`。

## 开发与测试

```powershell
npm ci
npm test
python -m unittest discover -s test -p 'test_*.py'
```

本仓库不提交本地构建缓存、用户数据和大型运行时二进制文件。完整 Windows 运行包请使用 Releases 中的发布文件。

## 使用边界

请只下载你拥有版权、获得授权或平台明确允许下载的内容。特殊网站需求可以联系微信 `open_java`，先评估技术可行性。

## 反馈

请在 Issues 中提供网站、错误提示和操作步骤，不要上传 Cookie、连接码、激活码或私人登录数据。
