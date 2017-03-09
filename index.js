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

logger.setOutput({file: path.resolve(process.cwd(), 'updater.log')});

var url = require('url');
var https = require('https');

const MANIFEST_DIR = path.resolve(process.cwd(), 'package.json');

var manifest = require(MANIFEST_DIR);

if (!manifest.autoupdater) {
    logger.error('package.json está sem as configurações de autoupdate. Verifique');
    throw 'package.json está sem as configurações de autoupdate. Verifique';
}

if (!manifest.autoupdater.AWS_access_key || !manifest.autoupdater.AWS_secret_acccess_key || !manifest.autoupdater.AWS_region || !manifest.autoupdater.AWS_bucket_name) {
    logger.error('package.json está sem as configurações da AWS. Verifique');
    throw 'package.json está sem as configurações da AWS. Verifique';
}

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
        return false;
    }
}

var app, appDir, appInstDir, appExec, bundledUpdaterPath;

if (isNWJS()) {
    logger.info('Aplicação rodando em NW.js');
    app = nw.App;
} else {
    logger.info('Aplicação rodando em Electron');
    app = require('electron').app;
}

shell.mkdir('-p', UPDATES_DIR);
logger.info('Pasta temporária criada em ' + UPDATES_DIR);

resolvePaths();

exports.checkForUpdates = function () {

    logger.info('iniciando checkUpdates');

    checkUpdates().then(function (contents) {

        var current_version = manifest.version;
        return getLatest(current_version, contents);

    }).then(function (data) {

        if (!data.url) {
            return;
        }

        var bundlePath = path.resolve(UPDATES_DIR, data.latest_version);

        return fetchUpdate(data.url, bundlePath)
            .then(notifyUser)
            .then(function (result) {
                if (result) {
                    startUpdate(bundlePath);
                }
            });

    }, function (err) {
        logger.error('Erro ao buscar updates');
        logger.error(err);
    });
};

function checkUpdates() {

    return new Promise(function (resolve, reject) {

        var current_version = manifest.version;
        var platform = (manifest.autoupdater.AWS_bucket_prefix ? (manifest.autoupdater.AWS_bucket_prefix + '/') : '') + process.platform;

        if (!current_version || !platform) {
            return reject("Parâmetros incompletos. Verifique");
        }

        logger.info('buscando arquivos no S3 com parâmetros');
        logger.info('current_version: ' + current_version);
        logger.info('platform: ' + platform);
        logger.info('AWS_bucket_name: ' + manifest.autoupdater.AWS_bucket_name);

        s3.listObjects({
            Bucket: manifest.autoupdater.AWS_bucket_name,
            Prefix: platform
        }).on('success', function handlePage(r) {

            if (r.hasNextPage()) {
                r.nextPage().on('success', handlePage).send();
            } else {
                logger.info('buscou arquivos');
                resolve(r.data.Contents);
            }
        }).on('error', function (r) {
            logger.error('erro ao buscar arquivos no S3');
            logger.error(r);
            reject(r.message);
        }).send();
    });
}

function getLatest(current_version, files) {

    logger.info('buscando a ultima versao');

    return new Promise(function (resolve, reject) {

        var result = 0, urlParams = '';

        try {

            var ordered_files = [];

            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (file.Size > 0) {
                    ordered_files.push(file);
                }
            }

            logger.info('ordenando arquivos');

            ordered_files.sort(function (fileA, fileB) {

                logger.info('comparando: ' + fileA.Key + ' e ' + fileB.Key);

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

            logger.info('Último arquivo processado: ' + latest_file_name);

            var blocks = latest_file_name.split('_v');
            var latest_version = blocks[1].replace('.zip', '');

            urlParams = {Bucket: manifest.autoupdater.AWS_bucket_name, Key: latest_file.Key};
            result = versionCompare(latest_version, current_version);

        } catch (e) {
            logger.error('Erro ao processar os arquivos do S3');
            logger.error(e);
            resolve({});
        }

        if (result > 0) {

            s3.getSignedUrl('getObject', urlParams, function (err, url) {

                if (err) {
                    logger.error('Erro ao buscar a url do arquivo de atualização');
                    logger.error(err.message);
                    return reject(err.message);
                }

                var  nome_arquivo = APP_NAME_LOWER + '_v' + latest_version + '.zip';

                logger.info('URL do arquivo de atualização: ' + url);
                logger.info('nome do arquivo de atualização: ' + nome_arquivo);

                resolve({
                    url: url,
                    latest_version: nome_arquivo
                });
            });

        } else {
            logger.info('nao tem versão mais atualizada');
            resolve({});
        }
    });
}

function versionCompare(v1, v2, options) {

    logger.info('comparando versões: ' + v1 + ' e ' + v2);

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

    logger.info('resolvendo rotas...');

    if (process.platform === 'darwin') {
        appDir = path.resolve(process.execPath, '../../../../../../../');
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
        logger.error('Sistema não reconhecido pra habilitar o autoupdater');
        throw 'Sistema não reconhecido pra habilitar o autoupdater';
    }

    logger.info('rotas resolvidas');
    logger.info('appDir: ' + appDir);
    logger.info('appInstDir: ' + appInstDir);
    logger.info('appExec: ' + appExec);
    logger.info('bundledUpdaterPath: ' + bundledUpdaterPath);
}

function startUpdate(bundlePath) {

    logger.info('copiando o updater de ' + bundledUpdaterPath + ' para ' + UPDATER_BIN);

    shell.cp(bundledUpdaterPath, UPDATER_BIN);
    shell.chmod(755 & ~process.umask(), UPDATER_BIN);

    logger.info('chamando o updater em ' + UPDATER_BIN);

    child_process.spawn(UPDATER_BIN, [
        '--bundle', bundlePath,
        '--inst-dir', appInstDir,
        '--app-name', manifest.name
    ], {
        cwd: path.dirname(UPDATER_BIN),
        detached: true,
        stdio: 'ignore'
    }).unref();

    logger.info('saindo da aplicação e tentando chamar o executavel ' + appInstDir);

    app.quit();
}

function fetchUpdate(url, dest) {
    return fileExists(dest).then(function (exists) {
        logger.info('arquivo já existe? ' + (exists ? 'sim' : 'não'));
        if (exists) {
            return Promise.resolve(dest);
        }
        return downloadFile(url, dest);
    });
}

function downloadFile(source, dest) {

    return new Promise(function (resolve) {

        logger.info('Iniciando download do arquivo como host ' + url.parse(source).host + ' e path ' + url.parse(source).pathname);

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
                logger.info('terminou o download do arquivo');
                file.end();
                resolve();
            });
        });
    });
}
function progress(percent) {
    logger.info("andamento do download: " + parseInt(percent) + " %");
    // var progressBarWidth = percent * $element.width() / 100;
    // $element.find('div').css( "width", progressBarWidth );
}

function notifyUser() {

    return new Promise(function (resolve) {

        logger.info('notificando o usuário');

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
            logger.info('usuário clicou em sim, atualizando...');
            resolve(true);
        });

        notifier.on('timeout', function (notifierObject, options) {
            logger.info('sem resposta se é pra atualizar ou não');
            resolve(false);
        });
    });
}

function removeFile(filepath) {
    return new Promise(function (resolve, reject) {
        logger.info('removendo arquivo ' + filepath);
        fs.unlink(filepath, function (err) {
            if (err) {
                logger.error('Erro ao remover arquivo');
                logger.error(err);
                return reject(err);
            }
            resolve();
        });
    });
}

function fileExists(bundledUpdaterPath) {
    return new Promise(function (resolve) {
        logger.info('verificando se arquivo existe em ' + bundledUpdaterPath);
        fs.stat(bundledUpdaterPath, function (err, stats) {
            if (err) {
                logger.error('Erro ao verificar se arquivo existe');
                logger.error(err);
                if (err.code === 'ENOENT') {
                    return resolve(false);
                }
                throw err;
            }

            if (stats.isFile() && stats.size < 5000) {
                logger.info('arquivo existente mas com tamanho inválido: ' + stats.size + ', removendo...');
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