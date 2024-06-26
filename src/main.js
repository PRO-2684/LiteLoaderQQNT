const { net, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");


const loader = (new class {

    #exports = {};

    init() {
        // 加载插件
        for (const [slug, plugin] of Object.entries(LiteLoader.plugins)) {
            if (plugin.disabled || plugin.incompatible) {
                continue;
            }
            if (plugin.path.injects.main) {
                this.#exports[slug] = require(plugin.path.injects.main);
            }
        }
        return this;
    }

    onBrowserWindowCreated(window) {
        for (const [slug, plugin] of Object.entries(this.#exports)) {
            if (plugin?.onBrowserWindowCreated) {
                plugin.onBrowserWindowCreated(window);
            }
        }
    }

}).init();


ipcMain.handle("LiteLoader.LiteLoader.preload", (event) => {
    const qqnt_preload_path = event.sender.preload;
    return fs.readFileSync(qqnt_preload_path, "utf-8");
});


function processPreloadPath(qqnt_preload_path) {
    const liteloader_preload_path = path.join(LiteLoader.path.root, "src/preload.js");
    const asar_path = qqnt_preload_path.split(".asar")[0];

    let preload_path = "";

    if (asar_path == qqnt_preload_path) {
        const preload_path_dirname = path.dirname(qqnt_preload_path).replaceAll("\\", "/");
        preload_path = `${preload_path_dirname}/../application/preload.js`;
    }
    else {
        const asar_path_dirname = path.dirname(qqnt_preload_path.split(".asar")[1]);
        preload_path = `${asar_path}/../${path.basename(asar_path)}${asar_path_dirname}/preload.js`;
    }

    if (!fs.existsSync(preload_path)) {
        fs.mkdirSync(path.dirname(preload_path), { recursive: true });
        fs.copyFileSync(liteloader_preload_path, preload_path);
    }

    if (fs.readFileSync(preload_path, "utf-8") != fs.readFileSync(liteloader_preload_path, "utf-8")) {
        fs.copyFileSync(liteloader_preload_path, preload_path);
    }

    return preload_path;
}


// 注册协议
function protocolRegister(protocol) {
    if (!protocol.isProtocolRegistered("local")) {
        protocol.handle("local", (req) => {
            const { host, pathname } = new URL(decodeURI(req.url));
            const filepath = path.normalize(pathname.slice(1));
            switch (host) {
                case "root": return net.fetch(`file:///${LiteLoader.path.root}/${filepath}`);
                case "profile": return net.fetch(`file:///${LiteLoader.path.profile}/${filepath}`);
                default: return net.fetch(`file://${host}/${filepath}`);
            }
        });
    }
}


function proxyBrowserWindowConstruct(target, [config], newTarget) {
    const qqnt_preload_path = config.webPreferences.preload;
    const window = Reflect.construct(target, [
        {
            ...config,
            webPreferences: {
                ...config.webPreferences,
                webSecurity: false,
                devTools: true,
                preload: processPreloadPath(qqnt_preload_path),
                additionalArguments: ["--fetch-schemes=local"]
            }
        }
    ], newTarget);

    // 挂载窗口原preload
    window.webContents.preload = qqnt_preload_path;

    //加载自定义协议
    protocolRegister(window.webContents.session.protocol);

    // 加载插件
    loader.onBrowserWindowCreated(window);

    return window;
}


// 监听窗口创建
require.cache["electron"] = new Proxy(require.cache["electron"], {
    get(target, property, receiver) {
        const electron = Reflect.get(target, property, receiver);
        if (property == "exports") {
            return new Proxy(electron, {
                get(target, property, receiver) {
                    const BrowserWindow = Reflect.get(target, property, receiver);
                    if (property == "BrowserWindow") {
                        return new Proxy(BrowserWindow, {
                            construct: proxyBrowserWindowConstruct
                        });
                    }
                    return BrowserWindow;
                }
            });
        }
        return electron;
    }
});
