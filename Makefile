.PHONY: artifact

artifact:
	rm -rf dist
	rm -rf App.MasterDataEditor/log
	rm -rf App.MasterDataEditor/bin
	dotnet.exe build App.MasterDataEditor --configuration Release -o dist
	(cd WebView && npm run build)
	mkdir -p dist/WebView
	cp -r WebView/dist/* dist/WebView
	(cd dist && zip -r ../App.MasterDataEditor_${APP_VERSION}.zip .)
	git.exe tag ${APP_VERSION} || true
	git.exe push origin master
	git.exe push origin --tags
	explorer.exe . || true
	echo https://github.com/yumayo/App.MasterDataEditor/releases/new
