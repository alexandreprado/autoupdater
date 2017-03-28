# autoupdater

MacOS
----------


Electron


1 - Compilar com "npm run packageMac64"

2 - Entrar na pasta do .app compilado e executar "tar -zcvf <nome_do_app>_v<versao>.tar.gz ./<nome_do_app>.app"

3 - Enviar à AWS

Para criar o instalador, colocar em uma pasta o .app e o dmg.json e executar "appdmg dmg.json <nome_do_app>_v<versao>.dmg" 


NW.js


1 - Compilar com "nwbuild -p osx64 -v 0.20.3 --macIcns <caminho_para_icone_icns> ./". Antes de compilar, deletar o .app compilado anteriormente, se houver.

2 - Entrar na pasta do .app compilado e executar "tar -zcvf <nome_do_app>_v<versao>.tar.gz ./<nome_do_app>.app"

3 - Enviar à AWS

Para criar o instalador, colocar em uma pasta o .app e o dmg.json e executar "appdmg dmg.json <nome_do_app>_v<versao>.dmg" 


Windows
----------


Electron


1 - Compilar com "npm run packageWin32"

2 - Zipar a pasta do app no windows com o nome de <nome_do_app>_v<versao>.zip. Importante! Se for zipado no mac, na hora de atualizar gera erro de header inválido. O .zip deve conter todos os arquivos na raiz!!!

3 - Enviar à AWS

Para criar instalador, utilizar o InnoSetup do windows


NW.js


1 - NW.js não é compilado, basta colocar os arquivos do projeto dentro de uma pasta com os binários do NW.js (que tenha o nw.exe)

2 - Renomear o nw.exe para <nome_do_app>.exe

3 - Zipar a pasta do app no windows com o nome de <nome_do_app>_v<versao>.zip. Importante! Se for zipado no mac, na hora de atualizar gera erro de header inválido. O .zip deve conter todos os arquivos na raiz!!!

4 - Enviar à AWS

Para criar instalador, utilizar o InnoSetup do windows


Autoupdater
------------


1 - Acessar $HOME/go/src/nwjs-autoupdater/. Os dois fontes (mac e windows) estão disponíveis para edição em updater/updater_darwin.go e updater/updater_windows.go

2 - Executar "rsrc -manifest nwjs-autoupdater.exe.manifest -o nwjs-autoupdater.syso" para gerar o .syso. Se der erro de "rsrc - command not found", executar "export GOPATH=$HOME/go" e "export PATH=$PATH:$GOPATH/bin" nessa ordem

3 - Executar "env GOOS=darwin GOARCH=amd64 go build -ldflags "-s -w" -o build/updater" para gerar o executável para mac

4 - Executar "env GOOS=windows GOARCH=386 go build -ldflags "-s -w -H=windowsgui" -o build/updater.exe" pra gerar o executável para windows

5 - Copiar os dois executáveis e jogar na pasta do projeto do autoupdater

6 - Commitar e subir. Para adicionar ao projeto, incluir nas dependências do package.json a linha "autoupdater": "https://github.com/alexandreprado/autoupdater/tarball/master"
