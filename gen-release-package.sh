
rm -rf dist logseq-wucai-official-plugin-*
npm run build

tt=$( date "+%y%m%d%H%M" )
outfn="logseq-wucai-official-plugin-${tt}"
mkdir -p ./$outfn
cp logo.png LICENSE package.json readme.md ./$outfn

echo "done~ " $outfn
echo $(date)