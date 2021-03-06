/*
* Vieb - Vim Inspired Electron Browser
* Copyright (C) 2019-2020 Jelmer van Arnhem
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
/* eslint-disable no-console */
"use strict"

const {app, BrowserWindow, ipcMain, session} = require("electron")
const path = require("path")
const fs = require("fs")
const {ElectronBlocker} = require("@cliqz/adblocker-electron")

const printUsage = () => {
    console.log("Vieb: Vim Inspired Electron Browser\n")
    console.log("Usage: Vieb [options] <URLs>\n")
    console.log("Options:")
    console.log(" --help     Print this help and exit")
    console.log(" --version  Print program info with version and exit")
    console.log(" --portable Store ALL Vieb data in a relative ViebData folder")
    console.log(" --debug    Open with Chromium and Electron debugging tools")
    console.log(" --console  Open with the Vieb console (implied by --debug)")
    console.log("\nAll arguments not starting with - will be opened as a url.")
    printLicense()
}
const printVersion = () => {
    const version = process.env.npm_package_version || app.getVersion()
    console.log("Vieb: Vim Inspired Electron Browser\n")
    console.log(`This is version ${version} of Vieb.`)
    console.log("Vieb is based on Electron and inspired by Vim.")
    console.log("It can be used to browse the web entirely with the keyboard.")
    console.log(`This release uses Electron ${
        process.versions.electron} and Chromium ${process.versions.chrome}`)
    printLicense()
}
const printLicense = () => {
    console.log("Vieb is created by Jelmer van Arnhem and contributors.")
    console.log("Website: https://vieb.dev OR https://github.com/Jelmerro/Vieb")
    console.log("\nLicense GPLv3+: GNU GPL version 3 or "
        + "later <http://gnu.org/licenses/gpl.html>")
    console.log("This is free software; you are free to change and "
        + "redistribute it.")
    console.log("There is NO WARRANTY, to the extent permitted by law.")
    console.log("See the LICENSE file or the GNU website for details.")
}

// Parse arguments
let args = process.argv.slice(1)
if (args[0] === "app") {
    args = args.slice(1)
}
const urls = []
let enableDebugMode = false
let showInternalConsole = false
let portable = false
args.forEach(arg => {
    arg = arg.trim()
    if (arg.startsWith("--")) {
        if (arg === "--help") {
            printUsage()
            app.exit(0)
        } else if (arg === "--version") {
            printVersion()
            app.exit(0)
        } else if (arg === "--portable") {
            portable = true
        } else if (arg === "--debug") {
            enableDebugMode = true
        } else if (arg === "--console") {
            showInternalConsole = true
        } else {
            console.log(`Unsupported argument: ${arg}`)
            printUsage()
            app.exit(1)
        }
    } else if (!arg.startsWith("-")) {
        urls.push(arg)
    }
})
if (portable) {
    app.setPath("appData", path.join(process.cwd(), "ViebData"))
    app.setPath("userData", path.join(process.cwd(), "ViebData"))
} else {
    app.setPath("appData", path.join(app.getPath("appData"), "Vieb"))
    app.setPath("userData", app.getPath("appData"))
}
if (showInternalConsole && enableDebugMode) {
    console.log("the --debug argument always opens the internal console")
}

// When the app is ready to start, open the main window
let mainWindow = null
let loginWindow = null
let notificationWindow = null
app.on("ready", () => {
    // Request single instance lock and quit if that fails
    if (app.requestSingleInstanceLock()) {
        app.on("second-instance", (_, commandLine) => {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.focus()
            commandLine = commandLine.slice(1)
            if (commandLine[0] === "app") {
                commandLine = commandLine.slice(1)
            }
            mainWindow.webContents.send("urls",
                commandLine.filter(arg => !arg.startsWith("-")))
        })
    } else {
        app.exit(0)
    }
    // Init mainWindow
    const windowData = {
        "title": "Vieb",
        "width": 800,
        "height": 600,
        "frame": enableDebugMode,
        "transparent": !enableDebugMode,
        "show": enableDebugMode,
        "closable": false,
        "webPreferences": {
            "sandbox": false,
            "contextIsolation": false,
            "disableBlinkFeatures": "Auxclick",
            "nodeIntegration": true,
            "webviewTag": true,
            "enableRemoteModule": true
        }
    }
    if (!app.isPackaged) {
        windowData.icon = path.join(__dirname, "img/icons/512x512.png")
    }
    mainWindow = new BrowserWindow(windowData)
    if (!enableDebugMode) {
        mainWindow.removeMenu()
    }
    mainWindow.setMinimumSize(500, 500)
    mainWindow.on("close", e => {
        e.preventDefault()
        mainWindow.webContents.send("window-close")
    })
    mainWindow.on("closed", () => {
        app.exit(0)
    })
    // Load app and send urls when ready
    mainWindow.loadURL(`file://${path.join(__dirname, "index.html")}`)
    mainWindow.webContents.once("did-finish-load", () => {
        mainWindow.webContents.on("new-window", e => e.preventDefault())
        mainWindow.webContents.on("will-navigate", e => e.preventDefault())
        mainWindow.webContents.on("will-redirect", e => e.preventDefault())
        if (enableDebugMode || showInternalConsole) {
            mainWindow.webContents.openDevTools()
        }
        mainWindow.webContents.send("urls", urls)
    })
    // Show a dialog for sites requiring Basic HTTP authentication
    const loginWindowData = {
        "backgroundColor": "#333333",
        "modal": true,
        "frame": false,
        "show": false,
        "parent": mainWindow,
        "alwaysOnTop": true,
        "webPreferences": {
            "sandbox": false,
            "contextIsolation": false,
            "disableBlinkFeatures": "Auxclick",
            "nodeIntegration": true,
            "partition": "login"
        }
    }
    loginWindow = new BrowserWindow(loginWindowData)
    const loginPage = `file:///${path.join(__dirname, "./pages/login.html")}`
    loginWindow.loadURL(loginPage)
    loginWindow.on("close", e => {
        e.preventDefault()
        loginWindow.hide()
    })
    // Show a dialog for large notifications
    const notificationWindowData = {
        "backgroundColor": "#333333",
        "modal": true,
        "frame": false,
        "show": false,
        "parent": mainWindow,
        "alwaysOnTop": true,
        "webPreferences": {
            "sandbox": false,
            "contextIsolation": false,
            "disableBlinkFeatures": "Auxclick",
            "nodeIntegration": true,
            "partition": "notification-window"
        }
    }
    notificationWindow = new BrowserWindow(notificationWindowData)
    const notificationPage = `file:///${path.join(
        __dirname, "./pages/notificationmessage.html")}`
    notificationWindow.loadURL(notificationPage)
    notificationWindow.on("close", e => {
        e.preventDefault()
        notificationWindow.hide()
    })
})

// Handle Basic HTTP login attempts (must be in main)
const loginAttempts = []
app.on("login", (e, webContents, _, auth, callback) => {
    if (loginWindow.isVisible()) {
        return
    }
    if (loginAttempts.includes(webContents.id)) {
        webContents.stop()
        loginAttempts.splice(loginAttempts.indexOf(webContents.id), 1)
        return
    }
    e.preventDefault()
    loginAttempts.push(webContents.id)
    loginWindow.setTitle(`${auth.host}: ${auth.realm}`)
    ipcMain.removeAllListeners("hide")
    loginWindow.once("hide", () => {
        try {
            callback("", "")
        } catch (err) {
            // Window was already closed
        }
    })
    ipcMain.removeAllListeners("login-credentials")
    ipcMain.once("login-credentials", (__, credentials) => {
        try {
            callback(credentials[0], credentials[1])
            loginWindow.hide()
        } catch (err) {
            // Window is already being closed
        }
    })
})

// Set correct download path (must be in main)
ipcMain.on("downloads-path-for-session", (_, name) => {
    session.fromPartition(name).on("will-download", (__, item) => {
        const filename = item.getFilename()
        let save = path.join(app.getPath("downloads"), filename)
        let duplicateNumber = 1
        let newFilename = item.getFilename()
        while (fs.existsSync(save) && fs.statSync(save).isFile()) {
            duplicateNumber += 1
            const extStart = filename.lastIndexOf(".")
            if (extStart === -1) {
                newFilename = `${filename} (${duplicateNumber})`
            } else {
                newFilename = `${filename.substring(0, extStart)
                } (${duplicateNumber}).${
                    filename.substring(extStart + 1)}`
            }
            save = path.join(app.getPath("downloads"), newFilename)
        }
        // Send the details to the renderer process as a fallback,
        // so there are still details for destoyed download items.
        mainWindow.webContents.send("downloads-details", {
            "name": item.getFilename(),
            "url": item.getURL(),
            "total": item.getTotalBytes(),
            "file": save
        })
        item.setSavePath(save)
    })
})

// Enable or disable adblocker for a list of sessions (must be in main)
let blocker = null
const enableAdblocker = sessionList => {
    if (blocker) {
        sessionList.forEach(
            s => blocker.enableBlockingInSession(session.fromPartition(s)))
    } else {
        createAdblocker(sessionList)
    }
}
const disableAdblocker = sessionList => {
    sessionList.forEach(
        s => blocker.disableBlockingInSession(session.fromPartition(s)))
}
const createAdblocker = sessionList => {
    const blocklistsFolder = path.join(app.getPath("appData"), "blocklists")
    // Read all filter files from the blocklists folder (including user added)
    let filters = ""
    try {
        for (const file of fs.readdirSync(blocklistsFolder)) {
            if (file.endsWith(".txt")) {
                filters += loadBlocklist(file)
            }
        }
    } catch (e) {
        console.log("Failed to read the files from blocklists folder", e)
    }
    blocker = ElectronBlocker.parse(filters)
    enableAdblocker(sessionList)
}
ipcMain.on("adblock-enable", (_, sessionList) => {
    enableAdblocker(sessionList)
})
ipcMain.on("adblock-disable", (_, sessionList) => {
    disableAdblocker(sessionList)
})
ipcMain.on("adblock-recreate", (_, sessionList) => {
    createAdblocker(sessionList)
})
const loadBlocklist = file => {
    const appdataName = path.join(app.getPath("appData"), `blocklists/${file}`)
    try {
        return `${fs.readFileSync(appdataName).toString()}\n`
    } catch (e) {
        return ""
    }
}
