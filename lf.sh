for dir in WebView sample-workdir App.MasterDataEditor; do
(
    cd "$dir" || exit
    git grep -Ilz $'\r' -- . | xargs -0 -r perl -0pi -e 's/\r\n/\n/g'
)
done