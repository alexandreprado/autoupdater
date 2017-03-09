/**
 * Created by Prado on 07/03/17.
 */

var AWS = require('aws-sdk');
var child_process = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var shell = require('shelljs');
var notifier = require('node-notifier');
var logger = require('electron-logger');


logger.setOutput({file: "./tmp.log"});

var url = require('url');
var https = require('https');

const MANIFEST_DIR = path.resolve(process.cwd(), 'package.json');

var manifest = require(MANIFEST_DIR);

AWS.config.update({
    accessKeyId: manifest.autoupdater.AWS_access_key,
    secretAccessKey: manifest.autoupdater.AWS_secret_acccess_key,
    region: manifest.autoupdater.AWS_region
});

var s3 = new AWS.S3();

const SYSTEM_TEMP_DIR = os.tmpdir();
const APP_NAME_LOWER = manifest.name.toLowerCase();
const TMP_FOLDER = APP_NAME_LOWER + '-updater';
const UPDATER_TEMP_DIR = path.resolve(SYSTEM_TEMP_DIR, TMP_FOLDER);
const UPDATES_DIR = path.resolve(UPDATER_TEMP_DIR, 'updates');
const UPDATER_BIN = path.resolve(UPDATER_TEMP_DIR, /^win/.test(process.platform) ? 'updater.exe' : 'updater');

function isNWJS() {
    try {
        return (typeof nw !== "undefined");
    } catch (e) {
        console.log(e);
        return false;
    }
}

var app, appDir, appInstDir, appExec, bundledUpdaterPath;

if (isNWJS()) {
    app = nw.App;
} else {
    app = require('electron').app;
}

shell.mkdir('-p', UPDATES_DIR);

resolvePaths();

exports.checkForUpdates = function () {

    checkUpdates().then(function (contents) {

        var current_version = manifest.version;
        return getLatest(current_version, contents);

    }).then(function (data) {

        if (!data.url) {
            console.log('Sem updates!');
            return;
        }

        console.log('initializing downloads: ' + data.url);

        var bundlePath = path.resolve(UPDATES_DIR, data.latest_version);

        return fetchUpdate(data.url, bundlePath)
            .then(notifyUser)
            .then(function (result) {
                if (result) {
                    startUpdate(bundlePath);
                }
            });

    }, function (err) {
        console.log('Erro ao buscar updates');
        console.log(err);
    });
};

function checkUpdates() {

    console.log('checking for updates');

    return new Promise(function (resolve, reject) {

        var current_version = manifest.version;
        var platform = (manifest.autoupdater.AWS_bucket_prefix ? (manifest.autoupdater.AWS_bucket_prefix + '/') : '') + process.platform;

        if (!current_version || !platform) {
            return reject("Parâmetros incompletos. Verifique");
        }

        console.log('pasta: ' + platform);

        s3.listObjects({Bucket: manifest.autoupdater.AWS_bucket_name, Prefix: platform}).on('success', function handlePage(r) {

            if (r.hasNextPage()) {
                r.nextPage().on('success', handlePage).send();
            } else {
                console.log('buscou update');
                console.log(r.data.Contents);
                resolve(r.data.Contents);
            }
        }).on('error', function (r) {
            console.log(r);
            reject(r.message);
        }).send();
    });
}

function getLatest(current_version, files) {

    console.log('buscando a ultima versao');

    return new Promise(function (resolve, reject) {

        var ordered_files = [];

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (file.Size > 0) {
                ordered_files.push(file);
            }
        }

        console.log('ordenando');

        ordered_files.sort(function (fileA, fileB) {

            console.log('comparando: ' + fileA.Key + ' e ' + fileB.Key);

            var filenameA = fileA.Key;
            var blocksA = filenameA.split('_v');

            if (!blocksA[1]) return 0;

            var versionA = blocksA[1].replace('.zip', '');

            var filenameB = fileB.Key;
            var blocksB = filenameB.split('_v');

            if (!blocksB[1]) return 0;

            var versionB = blocksB[1].replace('.zip', '');

            return versionCompare(versionB, versionA);
        });

        var latest_file = ordered_files[0];
        var latest_file_name = latest_file.Key;
        var blocks = latest_file_name.split('_v');
        var latest_version = blocks[1].replace('.zip', '');

        var urlParams = {Bucket: manifest.autoupdater.AWS_bucket_name, Key: latest_file.Key};

        var result = versionCompare(latest_version, current_version);

        if (result > 0) {

            s3.getSignedUrl('getObject', urlParams, function (err, url) {

                if (err) {
                    console.log(err);
                    return reject(err.message);
                }

                resolve({
                    url: url,
                    latest_version: APP_NAME_LOWER + '_v' + latest_version + '.zip'
                });
            });

        } else {
            console.log('nao tem mais nova');
            resolve({});
        }
    });
}

function versionCompare(v1, v2, options) {

    var lexicographical = options && options.lexicographical,
        zeroExtend = options && options.zeroExtend,
        v1parts = v1.split('.'),
        v2parts = v2.split('.');

    function isValidPart(x) {
        return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
    }

    if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
        return NaN;
    }

    if (zeroExtend) {
        while (v1parts.length < v2parts.length) v1parts.push("0");
        while (v2parts.length < v1parts.length) v2parts.push("0");
    }

    if (!lexicographical) {
        v1parts = v1parts.map(Number);
        v2parts = v2parts.map(Number);
    }

    for (var i = 0; i < v1parts.length; ++i) {
        if (v2parts.length == i) {
            return 1;
        }

        if (v1parts[i] == v2parts[i]) {
            continue;
        }
        else if (v1parts[i] > v2parts[i]) {
            return 1;
        }
        else {
            return -1;
        }
    }

    if (v1parts.length != v2parts.length) {
        return -1;
    }

    return 0;
}

function resolvePaths() {

    console.log('resolving paths');

    if (process.platform === 'darwin') {
        appDir = path.resolve(process.execPath, '../../../../../../../../JustRestaurante.app');
        appInstDir = path.dirname(appDir);
        appExec = appDir;

        if (isNWJS()) {
            bundledUpdaterPath = path.resolve(appDir, 'Contents', 'Resources', 'app.nw', 'node_modules', 'autoupdater', 'updater');
        } else {
            bundledUpdaterPath = path.resolve(appDir, 'Contents', 'Resources', 'app', 'node_modules', 'autoupdater', 'updater');
        }
    } else if (process.platform === 'win32') {
        appDir = path.resolve(path.dirname(process.execPath), 'package.nw');
        appInstDir = appDir;
        appExec = path.resolve(appDir, manifest.name + '.exe');

        if (isNWJS()) {
            bundledUpdaterPath = path.resolve(appDir, 'node_modules', 'autoupdater', 'updater.exe');
        } else {
            bundledUpdaterPath = path.resolve(appDir, 'resources', 'app', 'node_modules', 'autoupdater', 'updater.exe');
        }
    } else {

    }
}

function startUpdate(bundlePath) {
    shell.cp(bundledUpdaterPath, UPDATER_BIN);
    shell.chmod(755 & ~process.umask(), UPDATER_BIN);

    console.log('tentando chamar: ' + UPDATER_BIN);

    child_process.spawn(UPDATER_BIN, [
        '--bundle', bundlePath,
        '--inst-dir', appInstDir,
        '--app-name', manifest.name
    ], {
        cwd: path.dirname(UPDATER_BIN),
        detached: true,
        stdio: 'ignore'
    }).unref();

    app.quit();
}

function fetchUpdate(url, dest) {
    return fileExists(dest).then(function (exists) {
        if (exists) {
            return Promise.resolve(dest);
        }
        return downloadFile(url, dest);
    });
}

function downloadFile(source, dest) {

    return new Promise(function (resolve) {

        var options = {
            host: url.parse(source).host,
            path: url.parse(source).pathname
        };

        var file = fs.createWriteStream(dest);

        https.get(options, function (res) {
            var fsize = res.headers['content-length'];
            res.on('data', function (data) {
                file.write(data);
                progress(100 - (((fsize - file.bytesWritten) / fsize) * 100));
            }).on('end', function () {
                console.log('terminou');
                file.end();
                resolve();
            });
        });
    });
}
function progress(percent) {
    console.log("Download: " + parseInt(percent) + " %");
    // var progressBarWidth = percent * $element.width() / 100;
    // $element.find('div').css( "width", progressBarWidth );
}

function notifyUser() {

    return new Promise(function (resolve) {

        var notification_body = manifest.autoupdater.notification_message_body ? manifest.autoupdater.notification_message_body : 'Clique aqui para instalar';
        var notification_title = manifest.autoupdater.notification_message_title ? manifest.autoupdater.notification_message_title : 'Uma nova versão está disponível!';

        var options = {
            title: notification_title,
            message: notification_body,
            sound: true, // Only Notification Center or Windows Toasters
            wait: true // Wait with callback, until user action is taken against notification,
        };

        if (manifest.autoupdater.notification_icon_png) {
            options.icon = manifest.autoupdater.notification_icon_png;
        }

        notifier.notify(options);

        notifier.on('click', function (notifierObject, options) {
            resolve(true);
        });

        notifier.on('timeout', function (notifierObject, options) {
            resolve(false);
        });
    });
}

function removeFile(filepath) {
    return new Promise(function (resolve, reject) {
        fs.unlink(filepath, function (err) {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

function fileExists(bundledUpdaterPath) {
    return new Promise(function (resolve) {
        fs.stat(bundledUpdaterPath, function (err, stats) {
            if (err) {
                if (err.code === 'ENOENT') {
                    return resolve(false);
                }
                throw err;
            }
            if (stats.size < 5000) {
                return removeFile(bundledUpdaterPath).then(function () {
                    return resolve(false);
                });
            }
            if (stats.isFile()) {
                return resolve(true);
            }
            resolve(false);
        });
    });
}