# LogiGlobe Pro 部署指南 (Windows Server 2022)

注意：您的阿里云服务器使用的是 **Windows Server** 操作系统，而不是 Linux。请按照以下步骤进行部署。

## 1. 连接服务器 (远程桌面)
1.  在阿里云控制台点击蓝色的 **“远程连接”** 按钮。
2.  或者，在您自己的电脑上：
    *   按 `Win + R` 键，输入 `mstsc` 并回车。
    *   输入公网 IP：`121.41.69.91`。
    *   用户名通常为 `Administrator`。
    *   密码为您设置的实例密码（如果忘记，可在控制台点击“重置密码”）。

## 2. 准备环境 (Nginx)
由于是 Windows 服务器，最简单的方式是直接运行 Nginx。

1.  在服务器的浏览器中，访问 [http://nginx.org/en/download.html](http://nginx.org/en/download.html)。
2.  下载 **Stable version** (例如 nginx-1.24.0.zip)。
3.  解压到 C 盘根目录，例如 `C:\nginx`。

## 3. 上传项目文件
您可以通过远程桌面直接 **复制粘贴** 文件，或者使用网盘中转。

1.  将本地项目中的 `deployment/html` 文件夹复制。
2.  在服务器上，找到 Nginx 的安装目录（例如 `C:\nginx`）。
3.  删除 `C:\nginx\html` 下的原有文件。
4.  将我们的 `index.html` 粘贴进去。

## 4. 启动服务
1.  在服务器上打开文件夹 `C:\nginx`。
2.  双击运行 `nginx.exe`（屏幕可能会闪一下，这是正常的，它已经在后台运行了）。

## 5. 验证访问
1.  在服务器浏览器访问 `http://localhost` 确认是否显示。
2.  **关键步骤**：在阿里云控制台 -> **网络与安全组** -> **安全组配置** 中，确保 **入方向** 允许 **TCP 端口 80**。
3.  在您自己的电脑浏览器访问 `http://121.41.69.91`。

## 6. 常用命令 (在 PowerShell 中执行)
如果需要停止或重启 Nginx：
```powershell
cd C:\nginx
.\nginx.exe -s stop   # 停止
.\nginx.exe -s reload # 重启 (修改配置后)
```
