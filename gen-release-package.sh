
rm -rf dist dist_*
npm run build

tt=$( date "+%Y%m%d%H%M" )
outfn=dist_$tt
mkdir -p ./$outfn
cp logo.png LICENSE package.json readme.md ./$outfn

echo "done~ " $outfn
echo $(date)