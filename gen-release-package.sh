
rm -rf dist logseq-wucai-official-plugin-*
npm run build

tt=$( date "+%y%m%d" )
outfn="logseq-wucai-official-plugin-${tt}"
mkdir -p ./$outfn
cp logo.png LICENSE package.json readme.md ./$outfn
cp -rf screens ./$outfn
mv dist ./$outfn

echo "done~ " $outfn
echo $(date)